import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

/// Gateway API client — mirrors the endpoints in implementation.md §5:
///   POST /v1/cases/{case_id}/scans   (idempotent on capture_id)
///   POST /v1/scans/{scan_id}/process
///   GET  /v1/scans/{scan_id}
///   GET  /v1/cases
///   POST /v1/auth/login
class ApiClient {
  /// Point this at the deployed gateway. For local dev with an Android
  /// emulator use http://10.0.2.2:3000.
  static const String baseUrl =
      String.fromEnvironment('LMPC_API', defaultValue: 'http://10.0.2.2:3000');

  static const _storage = FlutterSecureStorage();
  String? _token;

  Uri _u(String path) => Uri.parse('$baseUrl/api/v1$path');

  Map<String, String> get _authHeaders => {
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

  Future<void> loadToken() async =>
      _token = await _storage.read(key: 'lmpc_token');

  bool get hasToken => _token != null;

  Future<Map<String, dynamic>> login(String username, String password) async {
    final res = await http.post(
      _u('/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'username': username, 'password': password}),
    );
    if (res.statusCode != 200) {
      throw ApiException._from(res);
    }
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    _token = body['token'] as String;
    await _storage.write(key: 'lmpc_token', value: _token);
    return body['user'] as Map<String, dynamic>;
  }

  Future<void> logout() async {
    try {
      await http.post(_u('/auth/logout'), headers: _authHeaders);
    } catch (_) {/* best effort */}
    _token = null;
    await _storage.delete(key: 'lmpc_token');
  }

  Future<List<dynamic>> listCases() async {
    final res = await http.get(_u('/cases'), headers: _authHeaders);
    if (res.statusCode != 200) throw ApiException._from(res);
    return (jsonDecode(res.body) as Map<String, dynamic>)['cases']
        as List<dynamic>;
  }

  /// Multipart upload of a queued scan. Server dedupes on capture_id:
  /// a retry after a network drop returns {"duplicate": true} with the
  /// original scan_id — never a second scan (design.md §4.1).
  Future<String> uploadScan({
    required String caseId,
    required String captureId,
    required String packageType,
    required String declaredCategory,
    required String containerType,
    double? pdpAreaCm2,
    required bool scaleReference,
    required List<File> images,
    double? geoLat,
    double? geoLng,
    required DateTime capturedAt,
    required bool capturedOffline,
  }) async {
    final req = http.MultipartRequest('POST', _u('/cases/$caseId/scans'))
      ..headers.addAll(_authHeaders)
      ..fields['capture_id'] = captureId
      ..fields['package_type'] = packageType
      ..fields['declared_category'] = declaredCategory
      ..fields['container_type'] = containerType
      ..fields['scale_reference'] = scaleReference.toString()
      ..fields['device_class'] = 'mobile_flutter'
      ..fields['captured_at'] = capturedAt.toUtc().toIso8601String()
      ..fields['captured_offline'] = capturedOffline.toString();
    if (pdpAreaCm2 != null) {
      req.fields['pdp_area_cm2'] = pdpAreaCm2.toString();
    }
    if (geoLat != null && geoLng != null) {
      req.fields['geo_lat'] = geoLat.toString();
      req.fields['geo_lon'] = geoLng.toString();
    }
    for (final f in images.take(4)) {
      req.files.add(await http.MultipartFile.fromPath('images', f.path));
    }
    final streamed = await req.send();
    final res = await http.Response.fromStream(streamed);
    if (res.statusCode >= 300) throw ApiException._from(res);
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return body['scan_id'] as String;
  }

  Future<Map<String, dynamic>> processScan(String scanId) async {
    final res = await http
        .post(_u('/scans/$scanId/process'), headers: _authHeaders)
        .timeout(const Duration(minutes: 3));
    if (res.statusCode != 200) throw ApiException._from(res);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> getScan(String scanId) async {
    final res = await http.get(_u('/scans/$scanId'), headers: _authHeaders);
    if (res.statusCode != 200) throw ApiException._from(res);
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  /// SHA-256 of an evidence file — matches server-side content addressing.
  static Future<String> sha256OfFile(File f) async =>
      sha256.convert(await f.readAsBytes()).toString();
}

class ApiException implements Exception {
  final int status;
  final String message;
  ApiException(this.status, this.message);

  factory ApiException._from(http.Response res) {
    String msg = 'HTTP ${res.statusCode}';
    try {
      final b = jsonDecode(res.body);
      if (b is Map && b['error'] != null) msg = b['error'].toString();
    } catch (_) {}
    return ApiException(res.statusCode, msg);
  }

  @override
  String toString() => message;
}
