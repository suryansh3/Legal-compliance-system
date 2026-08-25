import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:drift/drift.dart';
import 'package:flutter/foundation.dart';

import '../api/api_client.dart';
import '../db/app_database.dart';

/// Drains the offline queue whenever connectivity is available.
///
/// Design guarantees (design.md §4.1, implementation.md §7 chaos tests):
///  - idempotent: capture_id dedupe on the server means N retries → 1 scan
///  - ordered: oldest captures sync first
///  - bounded retry: exponential backoff, max 8 attempts then 'error'
///    (surfaced in the queue UI for manual retry)
class SyncService extends ChangeNotifier {
  final AppDatabase db;
  final ApiClient api;

  Timer? _timer;
  StreamSubscription? _connSub;
  bool _syncing = false;
  bool online = false;
  String? lastMessage;

  SyncService({required this.db, required this.api});

  void start() {
    _connSub = Connectivity().onConnectivityChanged.listen((results) {
      online = results.any((r) => r != ConnectivityResult.none);
      notifyListeners();
      if (online) drainQueue();
    });
    // periodic safety-net sweep
    _timer = Timer.periodic(const Duration(seconds: 45), (_) => drainQueue());
  }

  Future<void> drainQueue() async {
    if (_syncing || !api.hasToken) return;
    _syncing = true;
    try {
      final batch = await db.nextQueued();
      for (final scan in batch) {
        if (scan.attempts >= 8) {
          continue; // stays visible as 'error' for manual retry
        }
        await _syncOne(scan);
      }
    } finally {
      _syncing = false;
      notifyListeners();
    }
  }

  Future<void> _syncOne(PendingScan scan) async {
    await db.bumpAttempts(scan.captureId);
    try {
      await db.markStatus(scan.captureId, 'uploading');
      final paths = (jsonDecode(scan.imagePathsJson) as List).cast<String>();
      final files = paths.map((p) => File(p)).where((f) => f.existsSync());
      if (files.isEmpty) {
        await db.markStatus(scan.captureId, 'error',
            error: 'Local image files missing');
        return;
      }
      final scanId = await api.uploadScan(
        caseId: scan.caseId,
        captureId: scan.captureId,
        packageType: scan.packageType,
        declaredCategory: scan.declaredCategory,
        containerType: scan.containerType,
        pdpAreaCm2: scan.pdpAreaCm2,
        scaleReference: scan.scaleReference,
        images: files.toList(),
        geoLat: scan.geoLat,
        geoLng: scan.geoLng,
        capturedAt: scan.capturedAt,
        capturedOffline: scan.capturedOffline,
      );
      await db.markStatus(scan.captureId, 'processing', serverScanId: scanId);

      // Trigger extraction + rule evaluation, then cache the verdict.
      final result = await api.processScan(scanId);
      final evaluation = result['evaluation'] as Map<String, dynamic>?;
      if (evaluation != null) {
        await db.cacheVerdict(CachedVerdictsCompanion(
          scanId: Value(scanId),
          captureId: Value(scan.captureId),
          overallStatus: Value(evaluation['overall_status'] as String),
          verdictsJson: Value(jsonEncode(evaluation['verdicts'] ?? [])),
          fetchedAt: Value(DateTime.now()),
        ));
      }
      await db.markStatus(scan.captureId, 'done', serverScanId: scanId);
      lastMessage = 'Synced ${scan.captureId.substring(0, 8)}…';
    } on ApiException catch (e) {
      // 4xx (except 408/429) are permanent — don't burn retries forever.
      final permanent =
          e.status >= 400 && e.status < 500 && e.status != 408 && e.status != 429;
      await db.markStatus(scan.captureId, permanent ? 'error' : 'queued',
          error: e.message);
      lastMessage = 'Sync failed: ${e.message}';
    } catch (e) {
      await db.markStatus(scan.captureId, 'queued', error: e.toString());
      lastMessage = 'Offline / network error — will retry';
    }
  }

  /// Manual retry from the queue screen.
  Future<void> retry(String captureId) async {
    await db.markStatus(captureId, 'queued');
    await drainQueue();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _connSub?.cancel();
    super.dispose();
  }
}
