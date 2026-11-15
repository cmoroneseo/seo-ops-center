'use client';
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
export function ReplaceImage({ token, itemId, versionId, current, onSave, onClose }: {
  token: string;
  itemId: string;
  versionId: string;
  current?: string | null;
  onSave: (reservationId: string, previewUrl: string, note: string) => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const browse = useRef<HTMLButtonElement>(null);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const generation = useRef(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [uploaded, setUploaded] = useState<{
    id: string;
    url: string;
    heic: boolean;
  } | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => () => {
    generation.current++;
    xhr.current?.abort();
  }, []);
  const cancel = () => {
    generation.current++;
    xhr.current?.abort();
    setProgress(null);
  };
  async function upload(file?: File) {
    cancel();
    const attempt = generation.current;
    setError('');
    setUploaded(null);
    if (!file)
      return;
    const type = file.type || (/\.hei[cf]$/i.test(file.name) ? 'image/heic' : '');
    if (file.size > 15728640 || !['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(type)) {
      setError(file.size > 15728640 ? 'This image is too large. Choose an image up to 15 MB.' : 'Choose a JPG, PNG, WebP or HEIC image.');
      browse.current?.focus();
      return;
    }
    setProgress(0);
    try {
      const response = await fetch(`/api/public/approvals/${token}/image-upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, versionId, contentType: type, byteSize: file.size }) });
      const reserved = await response.json();
      if (!response.ok)
        throw new Error(reserved.error);
      if (generation.current !== attempt)
        return;
      await new Promise<void>((resolve, reject) => {
        const request = new XMLHttpRequest();
        xhr.current = request;
        request.open('PUT', reserved.signedUrl);
        request.setRequestHeader('Content-Type', type);
        request.upload.onprogress = event => {
          if (event.lengthComputable)
            setProgress(Math.round(event.loaded / event.total * 100));
        };
        request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error('Upload failed. Please try again.'));
        request.onerror = () => reject(new Error('Upload failed. Please try again.'));
        request.onabort = () => reject(new Error('Upload cancelled.'));
        request.send(file);
      });
      if (generation.current !== attempt)
        return;
      const completed = await fetch(`/api/public/approvals/${token}/image-upload/${reserved.reservationId}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId }) });
      const result = await completed.json();
      if (!completed.ok)
        throw new Error(result.error);
      if (generation.current === attempt)
        setUploaded({ id: reserved.reservationId, url: result.previewUrl, heic: ['image/heic', 'image/heif'].includes(type) });
    }
    catch (cause) {
      if (generation.current === attempt)
        setError(cause instanceof Error ? cause.message : 'Upload failed.');
    }
    finally {
      if (generation.current === attempt)
        setProgress(null);
    }
  }
  return <Dialog open onOpenChange={() => {
    cancel();
    onClose();
  }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogTitle>Suggest a replacement image</DialogTitle>
      <DialogDescription>The sent version is unchanged. Your account manager will review your suggestion.</DialogDescription>
      <div className="rounded-xl border-2 border-dashed p-6 text-center" onDragOver={event => event.preventDefault()} onDrop={event => {
        event.preventDefault();
        void upload(event.dataTransfer.files[0]);
      }}>
        <p>Drop an image here</p>
        <p>JPG, PNG, WebP or HEIC, up to 15 MB</p>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="sr-only" onChange={event => void upload(event.target.files?.[0])} />
        <button ref={browse} className="min-h-12 rounded border px-4" onClick={() => input.current?.click()}>Browse</button>
      </div>
      {error && <p role="alert">⚠ {error}</p>}
      {progress !== null && <div><p role="status">Uploading… {progress}%</p><progress aria-label="Uploading image" value={progress} max={100} /><button className="min-h-12 px-3" onClick={cancel}>Cancel upload</button></div>}
      <div className="grid grid-cols-2 gap-3">
        <figure><figcaption>Current</figcaption>{current && <img src={current} alt="Current image" />}</figure>
        {uploaded && <figure><figcaption>Your suggestion</figcaption><img src={uploaded.url} alt="Your replacement suggestion" />{uploaded.heic && <p className="text-sm">Preview converted from HEIC</p>}</figure>}
      </div>
      {uploaded && <p role="status">Uploaded</p>}
      <label>Why this image? (optional)<textarea className="block w-full rounded border p-3" value={note} maxLength={4000} onChange={event => setNote(event.target.value)} /></label>
      <p className="text-sm">Private to you and Marketing Empire Group. Nothing on your live site changes.</p>
      <div className="flex gap-3"><button className="min-h-12 rounded border px-4" disabled={!uploaded || !!error || progress !== null} onClick={() => {
        if (uploaded)
          onSave(uploaded.id, uploaded.url, note);
      }}>Save suggestion</button><button className="min-h-12 px-4" onClick={() => {
        cancel();
        onClose();
      }}>Cancel</button></div>
    </DialogContent>
  </Dialog>;
}
