"use client";
import { startTransition, useActionState, useRef, useState } from "react";
import type { ActionState } from "@/server/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** Upload a photo of the ID, or take one with the PC's camera (getUserMedia). */
export function IdCapture({ action, existing }: { action: Action; existing?: string | null }) {
  const [state, run, pending] = useActionState(action, undefined);
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camError, setCamError] = useState<string | null>(null);

  const startCam = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      setStream(s);
      setCamError(null);
      setTimeout(() => {
        if (video.current) video.current.srcObject = s;
      });
    } catch {
      setCamError("No camera found, or access was refused. Upload a photo instead.");
    }
  };
  const stopCam = () => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  };
  const snap = () => {
    const v = video.current;
    if (!v) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    canvas.toBlob((b) => {
      if (!b) return;
      const fd = new FormData();
      fd.set("file", new File([b], `id-${Date.now()}.jpg`, { type: "image/jpeg" }));
      startTransition(() => run(fd));
      stopCam();
    }, "image/jpeg", 0.9);
  };

  return (
    <div className="flex flex-col gap-2 text-[13px]">
      {existing && <a href={existing} target="_blank" rel="noreferrer">View the ID image on file</a>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => run(fd));
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <label className="sr-only" htmlFor="id-file">ID photo</label>
        <input id="id-file" type="file" name="file" accept="image/*,application/pdf" capture="environment" />
        <button type="submit" disabled={pending} className="h-8 rounded-control border border-line px-3 font-semibold hover:bg-surface-muted">Upload</button>
        {!stream && <button type="button" onClick={startCam} className="h-8 rounded-control border border-line px-3 font-semibold hover:bg-surface-muted">Use camera</button>}
      </form>
      {stream && (
        <div className="flex flex-col gap-2">
          <video ref={video} autoPlay playsInline muted className="max-w-[420px] rounded-control border border-line" />
          <div className="flex gap-2">
            <button type="button" onClick={snap} className="h-8 rounded-control bg-accent px-3 font-semibold text-white">Take photo</button>
            <button type="button" onClick={stopCam} className="h-8 rounded-control border border-line px-3">Cancel</button>
          </div>
        </div>
      )}
      {camError && <span role="alert" className="text-[#991b1b]">{camError}</span>}
      {state?.error && <span role="alert" className="text-[#991b1b]">{state.error}</span>}
      {state?.ok && <span role="status" className="text-[#166534]">{state.ok}</span>}
    </div>
  );
}
