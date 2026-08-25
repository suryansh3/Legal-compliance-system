import 'dart:convert';
import 'dart:io';

import 'package:camera/camera.dart';
import 'package:drift/drift.dart' show Value;
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../db/app_database.dart';
import '../services/sync_service.dart';
import '../widgets/scan_frame_overlay.dart';

/// GPay-style live camera capture of the package label, with a gallery
/// upload fallback. Captures are queued locally first (offline-first),
/// then synced by [SyncService].
class CaptureScreen extends StatefulWidget {
  final CachedCase forCase;
  const CaptureScreen({super.key, required this.forCase});

  @override
  State<CaptureScreen> createState() => _CaptureScreenState();
}

class _CaptureScreenState extends State<CaptureScreen>
    with WidgetsBindingObserver {
  CameraController? _camera;
  List<CameraDescription> _cameras = [];
  int _cameraIdx = 0;
  final List<File> _shots = [];
  bool _initializing = true;
  String? _cameraError;

  // Declaration metadata (matches web scan form)
  String _packageType = 'retail';
  String _category = '';
  String _containerType = 'printed';
  final _pdpArea = TextEditingController();
  bool _scaleRef = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initCamera();
  }

  Future<void> _initCamera() async {
    try {
      _cameras = await availableCameras();
      if (_cameras.isEmpty) {
        setState(() {
          _cameraError = 'No camera available — use gallery upload.';
          _initializing = false;
        });
        return;
      }
      // Prefer back camera
      _cameraIdx = _cameras.indexWhere(
          (c) => c.lensDirection == CameraLensDirection.back);
      if (_cameraIdx < 0) _cameraIdx = 0;
      await _openCamera();
    } catch (e) {
      setState(() {
        _cameraError = 'Camera error: $e';
        _initializing = false;
      });
    }
  }

  Future<void> _openCamera() async {
    await _camera?.dispose();
    _camera = CameraController(_cameras[_cameraIdx], ResolutionPreset.high,
        enableAudio: false);
    await _camera!.initialize();
    if (mounted) setState(() => _initializing = false);
  }

  Future<void> _flipCamera() async {
    if (_cameras.length < 2) return;
    setState(() => _initializing = true);
    _cameraIdx = (_cameraIdx + 1) % _cameras.length;
    await _openCamera();
  }

  Future<void> _shoot() async {
    if (_camera == null || !_camera!.value.isInitialized) return;
    if (_shots.length >= 4) {
      _snack('Maximum 4 photos');
      return;
    }
    final xfile = await _camera!.takePicture();
    final saved = await _persist(File(xfile.path));
    setState(() => _shots.add(saved));
  }

  Future<void> _pickFromGallery() async {
    final picked = await ImagePicker().pickMultiImage(imageQuality: 92);
    for (final x in picked) {
      if (_shots.length >= 4) break;
      final saved = await _persist(File(x.path));
      setState(() => _shots.add(saved));
    }
  }

  /// Copy into app documents so the queue survives app restarts / temp GC.
  Future<File> _persist(File src) async {
    final dir = await getApplicationDocumentsDirectory();
    final evidenceDir = Directory(p.join(dir.path, 'evidence'));
    if (!evidenceDir.existsSync()) evidenceDir.createSync(recursive: true);
    final dest = p.join(evidenceDir.path,
        'cap-${DateTime.now().millisecondsSinceEpoch}-${_shots.length}.jpg');
    return src.copy(dest);
  }

  Future<void> _queueScan() async {
    if (_shots.isEmpty) {
      _snack('Capture or upload at least one label photo');
      return;
    }
    final db = context.read<AppDatabase>();
    final sync = context.read<SyncService>();

    double? lat, lng;
    try {
      final perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.always ||
          perm == LocationPermission.whileInUse) {
        final pos = await Geolocator.getCurrentPosition(
            locationSettings:
                const LocationSettings(accuracy: LocationAccuracy.medium));
        lat = pos.latitude;
        lng = pos.longitude;
      }
    } catch (_) {/* geo optional */}

    await db.enqueueScan(PendingScansCompanion(
      captureId: Value(const Uuid().v4()),
      caseId: Value(widget.forCase.caseId),
      packageType: Value(_packageType),
      declaredCategory: Value(_category),
      containerType: Value(_containerType),
      pdpAreaCm2: Value(double.tryParse(_pdpArea.text)),
      scaleReference: Value(_scaleRef),
      imagePathsJson: Value(jsonEncode(_shots.map((f) => f.path).toList())),
      geoLat: Value(lat),
      geoLng: Value(lng),
      capturedAt: Value(DateTime.now()),
      capturedOffline: Value(!sync.online),
    ));

    if (!mounted) return;
    _snack(sync.online
        ? 'Queued — syncing now'
        : 'Saved offline — will sync when back online');
    sync.drainQueue();
    Navigator.of(context).pop();
  }

  void _snack(String msg) => ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(content: Text(msg)));

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Release the camera when backgrounded (required by camera plugin).
    if (state == AppLifecycleState.inactive) {
      _camera?.dispose();
    } else if (state == AppLifecycleState.resumed && _cameras.isNotEmpty) {
      _openCamera();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _camera?.dispose();
    _pdpArea.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: Text('Scan — ${widget.forCase.title}',
            style: const TextStyle(fontSize: 16)),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
      ),
      body: Column(
        children: [
          // ── Viewfinder ──
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (_camera != null &&
                    _camera!.value.isInitialized &&
                    !_initializing)
                  CameraPreview(_camera!)
                else
                  Center(
                    child: _cameraError != null
                        ? Padding(
                            padding: const EdgeInsets.all(24),
                            child: Text(_cameraError!,
                                style: const TextStyle(color: Colors.white70),
                                textAlign: TextAlign.center))
                        : const CircularProgressIndicator(color: Colors.white),
                  ),
                const ScanFrameOverlay(), // GPay-style corners + scanline
                // Shot tray
                if (_shots.isNotEmpty)
                  Positioned(
                    left: 12,
                    bottom: 12,
                    child: Row(
                      children: _shots
                          .asMap()
                          .entries
                          .map((e) => Padding(
                                padding: const EdgeInsets.only(right: 8),
                                child: GestureDetector(
                                  onLongPress: () =>
                                      setState(() => _shots.removeAt(e.key)),
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(8),
                                    child: Image.file(e.value,
                                        width: 52,
                                        height: 52,
                                        fit: BoxFit.cover),
                                  ),
                                ),
                              ))
                          .toList(),
                    ),
                  ),
              ],
            ),
          ),
          // ── Controls ──
          Container(
            color: Colors.black,
            padding: const EdgeInsets.symmetric(vertical: 14),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                IconButton(
                  onPressed: _pickFromGallery,
                  icon: const Icon(Icons.photo_library_outlined,
                      color: Colors.white, size: 30),
                  tooltip: 'Upload from gallery',
                ),
                // Shutter
                GestureDetector(
                  onTap: _shoot,
                  child: Container(
                    width: 72,
                    height: 72,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white38, width: 5),
                      color: Colors.white,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: _flipCamera,
                  icon: const Icon(Icons.flip_camera_ios_outlined,
                      color: Colors.white, size: 30),
                  tooltip: 'Flip camera',
                ),
              ],
            ),
          ),
          // ── Metadata + submit ──
          Container(
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            child: SafeArea(
              top: false,
              child: Column(
                children: [
                  Row(children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _packageType,
                        decoration: const InputDecoration(
                            labelText: 'Package type', isDense: true),
                        items: const [
                          DropdownMenuItem(
                              value: 'retail', child: Text('Retail')),
                          DropdownMenuItem(
                              value: 'wholesale', child: Text('Wholesale')),
                        ],
                        onChanged: (v) =>
                            setState(() => _packageType = v ?? 'retail'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextField(
                        controller: _pdpArea,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                            labelText: 'PDP area cm²', isDense: true),
                      ),
                    ),
                  ]),
                  CheckboxListTile(
                    value: _scaleRef,
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    controlAffinity: ListTileControlAffinity.leading,
                    title: const Text('Scale reference (ruler card) in frame',
                        style: TextStyle(fontSize: 13)),
                    onChanged: (v) => setState(() => _scaleRef = v ?? false),
                  ),
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: FilledButton.icon(
                      onPressed: _queueScan,
                      icon: const Icon(Icons.fact_check_outlined),
                      label: Text(
                          'Queue compliance check (${_shots.length}/4 photos)'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
