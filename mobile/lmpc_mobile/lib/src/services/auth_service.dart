import 'package:flutter/foundation.dart';

import '../api/api_client.dart';

class AuthService extends ChangeNotifier {
  final ApiClient api;
  Map<String, dynamic>? user;
  bool _restoring = true;

  AuthService(this.api) {
    _restore();
  }

  bool get isLoggedIn => api.hasToken;
  bool get restoring => _restoring;

  Future<void> _restore() async {
    await api.loadToken();
    _restoring = false;
    notifyListeners();
  }

  Future<void> login(String username, String password) async {
    user = await api.login(username, password);
    notifyListeners();
  }

  Future<void> logout() async {
    await api.logout();
    user = null;
    notifyListeners();
  }
}
