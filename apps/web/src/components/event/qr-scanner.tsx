import { useEffect, useRef, useState } from "react";
import { useT } from "#/lib/translate.tsx";

export function QrScanner({ onCode }: { onCode: (code: string) => void }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onCode);
  const supported = "BarcodeDetector" in window;
  const [problem, setProblem] = useState<string | null>(supported ? null : t("qr.unsupported"));

  useEffect(() => {
    handler.current = onCode;
  });

  useEffect(() => {
    if (!supported) return;
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let last = "";
    let cancelled = false;
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((media) => {
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        if (video.current) {
          video.current.srcObject = media;
          void video.current.play();
        }
        timer = window.setInterval(async () => {
          if (!video.current) return;
          const [found] = await detector.detect(video.current).catch(() => []);
          if (found && found.rawValue !== last) {
            last = found.rawValue;
            handler.current(found.rawValue);
            window.setTimeout(() => (last = ""), 3000);
          }
        }, 400);
      })
      .catch(() => setProblem(t("qr.noCamera")));
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [supported, t]);

  return (
    <div className="flex flex-col gap-2">
      <video ref={video} muted playsInline className="w-full max-w-sm rounded-xl" />
      {problem && <p className="text-sm text-muted-fg">{problem}</p>}
    </div>
  );
}
