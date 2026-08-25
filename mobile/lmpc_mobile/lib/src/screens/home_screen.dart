import 'dart:convert';

import 'package:drift/drift.dart' show Value;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../db/app_database.dart';
import '../services/auth_service.dart';
import '../services/sync_service.dart';
import 'capture_screen.dart';

/// Home = sync-queue view + case picker for a new scan.
/// The queue is the primary UI object per the offline-first design:
/// an officer must always see what is captured, what is synced, and
/// what failed (implementation.md §7 chaos tests).
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    _refreshCases();
  }

  Future<void> _refreshCases() async {
    final api = context.read<ApiClient>();
    final db = context.read<AppDatabase>();
    try {
      final cases = await api.listCases();
      await db.replaceCases(cases
          .map((c) => CachedCasesCompanion(
                caseId: Value(c['case_id'] as String),
                title: Value((c['title'] ?? c['case_id']) as String),
                regionId: Value(c['region_id'] as String),
                status: Value(c['status'] as String),
              ))
          .toList());
    } catch (_) {
      // offline — cached cases from last sync remain usable
    }
  }

  Future<void> _newScan() async {
    final db = context.read<AppDatabase>();
    final open = await db.openCases();
    if (!mounted) return;
    if (open.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text(
              'No open case cached — connect once to load your cases.')));
      return;
    }
    final chosen = await showModalBottomSheet<CachedCase>(
      context: context,
      builder: (_) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Select case for this scan',
                  style: TextStyle(fontWeight: FontWeight.bold)),
            ),
            ...open.map((c) => ListTile(
                  leading: const Icon(Icons.folder_open),
                  title: Text(c.title),
                  subtitle: Text('${c.caseId} · ${c.regionId}'),
                  onTap: () => Navigator.pop(context, c),
                )),
          ],
        ),
      ),
    );
    if (chosen != null && mounted) {
      await Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => CaptureScreen(forCase: chosen)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final db = context.read<AppDatabase>();
    final sync = context.watch<SyncService>();
    final auth = context.watch<AuthService>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('LM Compliance Checker'),
        backgroundColor: const Color(0xFF1E3A8A),
        foregroundColor: Colors.white,
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 4),
            child: Icon(sync.online ? Icons.cloud_done : Icons.cloud_off,
                color: sync.online ? Colors.greenAccent : Colors.orangeAccent),
          ),
          IconButton(
              onPressed: () => auth.logout(),
              icon: const Icon(Icons.logout),
              tooltip: 'Sign out'),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _newScan,
        icon: const Icon(Icons.camera_alt),
        label: const Text('New Scan'),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await _refreshCases();
          await sync.drainQueue();
        },
        child: StreamBuilder<List<PendingScan>>(
          stream: db.watchQueue(),
          builder: (context, snap) {
            final rows = snap.data ?? [];
            if (rows.isEmpty) {
              return ListView(children: const [
                SizedBox(height: 120),
                Icon(Icons.qr_code_scanner, size: 72, color: Colors.black26),
                SizedBox(height: 12),
                Center(
                    child: Text('No scans yet.\nTap "New Scan" to capture a label.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Colors.black54))),
              ]);
            }
            return ListView.separated(
              itemCount: rows.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, i) {
                final r = rows[i];
                final n = (jsonDecode(r.imagePathsJson) as List).length;
                return ListTile(
                  leading: _statusIcon(r.syncStatus),
                  title: Text('${r.caseId} · $n photo${n > 1 ? 's' : ''}'),
                  subtitle: Text(
                      '${r.syncStatus.toUpperCase()}${r.lastError != null ? ' — ${r.lastError}' : ''}\n'
                      'captured ${r.capturedAt.toLocal().toString().substring(0, 16)}'
                      '${r.capturedOffline ? ' (offline)' : ''}'),
                  isThreeLine: true,
                  trailing: r.syncStatus == 'error'
                      ? IconButton(
                          icon: const Icon(Icons.refresh),
                          onPressed: () => sync.retry(r.captureId))
                      : (r.syncStatus == 'done'
                          ? FutureBuilder<CachedVerdict?>(
                              future: db.verdictFor(r.serverScanId ?? ''),
                              builder: (_, v) => v.data == null
                                  ? const SizedBox.shrink()
                                  : _verdictChip(v.data!.overallStatus))
                          : null),
                );
              },
            );
          },
        ),
      ),
    );
  }

  Widget _statusIcon(String s) {
    switch (s) {
      case 'done':
        return const Icon(Icons.check_circle, color: Colors.green);
      case 'error':
        return const Icon(Icons.error, color: Colors.red);
      case 'uploading':
      case 'processing':
        return const SizedBox(
            width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2));
      default:
        return const Icon(Icons.schedule, color: Colors.orange);
    }
  }

  Widget _verdictChip(String status) {
    final (color, label) = switch (status) {
      'compliant' => (Colors.green, 'PASS'),
      'non_compliant' => (Colors.red, 'FAIL'),
      _ => (Colors.amber, 'REVIEW'),
    };
    return Chip(
      label: Text(label,
          style: const TextStyle(
              fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white)),
      backgroundColor: color,
      padding: EdgeInsets.zero,
      visualDensity: VisualDensity.compact,
    );
  }
}
