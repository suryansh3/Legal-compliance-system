import 'package:flutter/material.dart';

/// GPay-style scan frame: four white corner brackets + an animated
/// green scanline sweeping the frame.
class ScanFrameOverlay extends StatefulWidget {
  const ScanFrameOverlay({super.key});

  @override
  State<ScanFrameOverlay> createState() => _ScanFrameOverlayState();
}

class _ScanFrameOverlayState extends State<ScanFrameOverlay>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl = AnimationController(
      vsync: this, duration: const Duration(milliseconds: 2200))
    ..repeat(reverse: true);

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: LayoutBuilder(builder: (context, box) {
        final w = box.maxWidth * 0.78;
        final h = box.maxHeight * 0.55;
        return Stack(
          alignment: Alignment.center,
          children: [
            SizedBox(
              width: w,
              height: h,
              child: Stack(
                children: [
                  _corner(Alignment.topLeft),
                  _corner(Alignment.topRight),
                  _corner(Alignment.bottomLeft),
                  _corner(Alignment.bottomRight),
                  AnimatedBuilder(
                    animation: _ctrl,
                    builder: (_, __) => Positioned(
                      top: 8 + (h - 18) * _ctrl.value,
                      left: 10,
                      right: 10,
                      child: Container(
                        height: 2.5,
                        decoration: BoxDecoration(
                          color: const Color(0xFF34D399),
                          borderRadius: BorderRadius.circular(2),
                          boxShadow: [
                            BoxShadow(
                                color: const Color(0xFF34D399)
                                    .withValues(alpha: 0.8),
                                blurRadius: 12)
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Positioned(
              top: box.maxHeight * 0.08,
              child: const Text('Align the package label inside the frame',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      shadows: [Shadow(blurRadius: 6, color: Colors.black)])),
            ),
          ],
        );
      }),
    );
  }

  Widget _corner(Alignment a) {
    const s = 30.0, t = 4.0;
    final top = a.y < 0, left = a.x < 0;
    return Align(
      alignment: a,
      child: Container(
        width: s,
        height: s,
        decoration: BoxDecoration(
          border: Border(
            top: top ? const BorderSide(color: Colors.white, width: t) : BorderSide.none,
            bottom: !top ? const BorderSide(color: Colors.white, width: t) : BorderSide.none,
            left: left ? const BorderSide(color: Colors.white, width: t) : BorderSide.none,
            right: !left ? const BorderSide(color: Colors.white, width: t) : BorderSide.none,
          ),
        ),
      ),
    );
  }
}
