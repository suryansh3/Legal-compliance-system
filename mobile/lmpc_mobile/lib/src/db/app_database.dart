import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

part 'app_database.g.dart';

/// Offline scan queue — implementation.md §1: "local SQLite (drift) for
/// offline queue; offline-first is non-negotiable".
///
/// Every capture becomes a [PendingScans] row with a client-generated
/// capture_id (idempotency key). SyncService drains the queue; the server
/// dedupes on capture_id so retries never double-process (design.md §4.1).
class PendingScans extends Table {
  TextColumn get captureId => text()(); // uuid — idempotency key
  TextColumn get caseId => text()();
  TextColumn get packageType => text().withDefault(const Constant('retail'))();
  TextColumn get declaredCategory => text().withDefault(const Constant(''))();
  TextColumn get containerType =>
      text().withDefault(const Constant('printed'))();
  RealColumn get pdpAreaCm2 => real().nullable()();
  BoolColumn get scaleReference =>
      boolean().withDefault(const Constant(false))();
  /// JSON array of absolute local file paths of captured images (max 4).
  TextColumn get imagePathsJson => text()();
  RealColumn get geoLat => real().nullable()();
  RealColumn get geoLng => real().nullable()();
  DateTimeColumn get capturedAt => dateTime()();
  BoolColumn get capturedOffline =>
      boolean().withDefault(const Constant(true))();

  /// queued | uploading | uploaded | processing | done | error
  TextColumn get syncStatus => text().withDefault(const Constant('queued'))();
  TextColumn get serverScanId => text().nullable()();
  TextColumn get lastError => text().nullable()();
  IntColumn get attempts => integer().withDefault(const Constant(0))();
  DateTimeColumn get syncedAt => dateTime().nullable()();

  @override
  Set<Column> get primaryKey => {captureId};
}

/// Cached verdicts for offline viewing of past results.
class CachedVerdicts extends Table {
  TextColumn get scanId => text()();
  TextColumn get captureId => text()();
  TextColumn get overallStatus => text()(); // compliant|non_compliant|needs_review
  TextColumn get verdictsJson => text()(); // full verdict array from server
  DateTimeColumn get fetchedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {scanId};
}

/// Locally cached open cases so the officer can queue scans while offline.
class CachedCases extends Table {
  TextColumn get caseId => text()();
  TextColumn get title => text()();
  TextColumn get regionId => text()();
  TextColumn get status => text()();

  @override
  Set<Column> get primaryKey => {caseId};
}

@DriftDatabase(tables: [PendingScans, CachedVerdicts, CachedCases])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_openConnection());

  @override
  int get schemaVersion => 1;

  // ── Queue operations ──

  Future<void> enqueueScan(PendingScansCompanion scan) =>
      into(pendingScans).insert(scan, mode: InsertMode.insertOrIgnore);

  Future<List<PendingScan>> nextQueued({int limit = 3}) =>
      (select(pendingScans)
            ..where((t) =>
                t.syncStatus.equals('queued') | t.syncStatus.equals('error'))
            ..orderBy([(t) => OrderingTerm.asc(t.capturedAt)])
            ..limit(limit))
          .get();

  Stream<List<PendingScan>> watchQueue() => (select(pendingScans)
        ..orderBy([(t) => OrderingTerm.desc(t.capturedAt)]))
      .watch();

  Future<void> markStatus(String captureId, String status,
          {String? serverScanId, String? error}) =>
      (update(pendingScans)..where((t) => t.captureId.equals(captureId)))
          .write(PendingScansCompanion(
        syncStatus: Value(status),
        serverScanId:
            serverScanId != null ? Value(serverScanId) : const Value.absent(),
        lastError: Value(error),
        syncedAt: status == 'done'
            ? Value(DateTime.now())
            : const Value.absent(),
      ));

  Future<void> bumpAttempts(String captureId) => customUpdate(
        'UPDATE pending_scans SET attempts = attempts + 1 WHERE capture_id = ?',
        variables: [Variable.withString(captureId)],
        updates: {pendingScans},
      );

  // ── Case cache ──

  Future<void> replaceCases(List<CachedCasesCompanion> rows) =>
      transaction(() async {
        await delete(cachedCases).go();
        for (final r in rows) {
          await into(cachedCases).insert(r);
        }
      });

  Future<List<CachedCase>> openCases() =>
      (select(cachedCases)..where((t) => t.status.isNotValue('closed'))).get();

  // ── Verdict cache ──

  Future<void> cacheVerdict(CachedVerdictsCompanion v) =>
      into(cachedVerdicts).insertOnConflictUpdate(v);

  Future<CachedVerdict?> verdictFor(String scanId) =>
      (select(cachedVerdicts)..where((t) => t.scanId.equals(scanId)))
          .getSingleOrNull();
}

LazyDatabase _openConnection() {
  return LazyDatabase(() async {
    final dir = await getApplicationDocumentsDirectory();
    final file = File(p.join(dir.path, 'lmpc_queue.sqlite'));
    return NativeDatabase.createInBackground(file);
  });
}
