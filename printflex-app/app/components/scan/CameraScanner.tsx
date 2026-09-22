import { useEffect, useRef, useState } from "react";

/**
 * Camera scanning. Uses the browser's BarcodeDetector where it exists
 * (Chrome and Edge on Android, Safari 17+), otherwise loads @zxing/browser
 * on demand. Emits the raw decoded text; the caller decides what it means.
 */

interface Props {
  onResult: (text: string) => void;
  active: boolean;
}

interface DetectorLike {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats: string[] }) => DetectorLike;
  }
}

export function CameraScanner({ onResult, active }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<"native" | "zxing" | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let stop: (() => void) | null = null;
    const video = videoRef.current;
    if (!video) return;

    const emit = (text: string) => {
      if (cancelled || !text) return;
      cancelled = true;
      stop?.();
      onResult(text);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (cancelled) return;
        video.srcObject = stream;
        await video.play();

        if (window.BarcodeDetector) {
          setEngine("native");
          const detector = new window.BarcodeDetector({ formats: ["qr_code", "code_128"] });
          const tick = async () => {
            if (cancelled) return;
            try {
              const codes = await detector.detect(video);
              if (codes[0]?.rawValue) return emit(codes[0].rawValue);
            } catch {
              /* a frame failed to decode; keep going */
            }
            timer = window.setTimeout(tick, 150);
          };
          let timer = window.setTimeout(tick, 300);
          stop = () => window.clearTimeout(timer);
          return;
        }

        setEngine("zxing");
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromVideoElement(video, (result) => {
          if (result) emit(result.getText());
        });
        stop = () => controls.stop();
      } catch (err) {
        setError(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Camera access was refused. Allow the camera for this site, or type the order number below."
            : "The camera could not start. Type the order number below or use a USB scanner.",
        );
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
      stream?.getTracks().forEach((t) => t.stop());
      if (video) video.srcObject = null;
    };
  }, [active, onResult]);

  return (
    <div>
      <video ref={videoRef} playsInline muted />
      {error ? <p className="notice bad" style={{ marginTop: 10 }}>{error}</p> : (
        <p className="hint">Point at the QR code or the barcode on the sheet.{engine === "zxing" ? " Using the fallback decoder." : ""}</p>
      )}
    </div>
  );
}
