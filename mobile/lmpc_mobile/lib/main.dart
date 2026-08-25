import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'src/api/api_client.dart';
import 'src/db/app_database.dart';
import 'src/screens/home_screen.dart';
import 'src/screens/login_screen.dart';
import 'src/services/auth_service.dart';
import 'src/services/sync_service.dart';

/// Legal Metrology Compliance Checker — field officer app.
///
/// Offline-first per implementation.md §1: every capture is written to the
/// local drift/SQLite queue first, then synced (idempotent on capture_id)
/// when connectivity returns. Requirement per design.md — a flaky-network
/// retry must never double-process a scan.
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final db = AppDatabase();
  final api = ApiClient();
  runApp(LmpcApp(db: db, api: api));
}

class LmpcApp extends StatelessWidget {
  final AppDatabase db;
  final ApiClient api;
  const LmpcApp({super.key, required this.db, required this.api});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<AppDatabase>.value(value: db),
        Provider<ApiClient>.value(value: api),
        ChangeNotifierProvider(create: (_) => AuthService(api)),
        ChangeNotifierProvider(
          create: (_) => SyncService(db: db, api: api)..start(),
        ),
      ],
      child: MaterialApp(
        title: 'LM Compliance Checker',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF1E3A8A), // gov blue
            primary: const Color(0xFF1E40AF),
          ),
          useMaterial3: true,
        ),
        home: Consumer<AuthService>(
          builder: (_, auth, __) =>
              auth.isLoggedIn ? const HomeScreen() : const LoginScreen(),
        ),
      ),
    );
  }
}
