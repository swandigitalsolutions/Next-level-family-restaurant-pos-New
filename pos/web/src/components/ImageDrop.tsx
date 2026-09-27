/**
 * The dish photo field: drop a file on it, or tap it to pick one.
 *
 * The owner is not going to crop a photo before uploading it, so nothing here
 * asks them to. The file goes to the server as-is and comes back already cut
 * to the card's 16:10 and re-encoded — see catalogAdmin.uploadItemImage. What
 * the preview shows after an upload is the real stored file, not a local
 * object URL of the original, so the owner sees the actual crop before they
 * save rather than discovering it on the till.
 *
 * Tapping the tile opens the file picker, which on a phone offers the camera —
 * so a new dish can be photographed and listed without leaving the screen.
 */
import { useId, useRef, useState } from "react";
import { callable } from "../lib/api";
import { Icon } from "./Icon";
import "./ImageDrop.css";

const ACCEPT = "image/jpeg,image/png,image/webp";

/** Read a File as a data URL; the upload action accepts base64 either way. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("That file could not be read."));
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(file);
  });
}

export function ImageDrop({
  value,
  onChange,
  itemName,
  disabled,
}: {
  /** Current stored path, e.g. "/assets/menu/paneer-tikka-1a2b3c4d.webp". */
  value: string;
  onChange: (imageUrl: string) => void;
  /** Used to name the stored file, so the folder stays readable. */
  itemName: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const describedBy = useId();

  async function accept(file: File | undefined) {
    if (!file || disabled) return;
    setError(null);
    if (!ACCEPT.split(",").includes(file.type)) {
      setError("Please choose a JPG, PNG or WEBP photo.");
      return;
    }
    setBusy(true);
    try {
      const data = await readAsDataUrl(file);
      const out = await callable<{ image_url: string }>("catalogAdmin", "uploadItemImage", {
        data,
        name: itemName,
      });
      onChange(out.image_url);
    } catch (err: any) {
      setError(err?.message || "The photo could not be uploaded.");
    } finally {
      setBusy(false);
      // Clearing lets the same file be picked again after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="imgdrop-wrap">
      <div
        className={`imgdrop${over ? " is-over" : ""}${value ? " has-image" : ""}${busy ? " is-busy" : ""}`}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void accept(e.dataTransfer.files?.[0]);
        }}
      >
        {value && <img className="imgdrop-preview" src={value} alt="" />}

        <button
          type="button"
          className="imgdrop-hit"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
          aria-describedby={describedBy}
        >
          <Icon name={value ? "food" : "food"} />
          <span className="imgdrop-label">
            {busy ? "Uploading…" : value ? "Replace photo" : "Add a photo"}
          </span>
          <span className="imgdrop-hint" id={describedBy}>
            Drop an image here, or tap to choose. It is cut to fit the card automatically.
          </span>
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="imgdrop-input"
          onChange={(e) => void accept(e.target.files?.[0])}
          tabIndex={-1}
        />
      </div>

      {value && !busy && (
        <button
          type="button"
          className="imgdrop-remove"
          onClick={() => {
            setError(null);
            onChange("");
          }}
          disabled={disabled}
        >
          Remove photo
        </button>
      )}

      {error && (
        <p className="imgdrop-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
