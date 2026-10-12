import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

const FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.AZTEC,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.MAXICODE,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.PDF_417,
  Html5QrcodeSupportedFormats.RSS_14,
  Html5QrcodeSupportedFormats.RSS_EXPANDED,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
];

const MAX_SCAN_DIMENSION = 3200;

type ProcessOptions = {
  rotation?: number;
  invert?: boolean;
  contrast?: boolean;
  scale?: number;
};

function processCanvas(
  bitmap: ImageBitmap,
  options: ProcessOptions,
): HTMLCanvasElement {
  const rotation = options.rotation ?? 0;
  const swapSides = rotation % 180 !== 0;
  const scale = options.scale ?? 1;
  const longSide = Math.max(bitmap.width, bitmap.height) * scale;
  const capScale =
    longSide > MAX_SCAN_DIMENSION ? MAX_SCAN_DIMENSION / longSide : 1;
  const factor = scale * capScale;
  const drawWidth = Math.round(bitmap.width * factor);
  const drawHeight = Math.round(bitmap.height * factor);

  const canvas = document.createElement("canvas");
  canvas.width = swapSides ? drawHeight : drawWidth;
  canvas.height = swapSides ? drawWidth : drawHeight;

  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    return canvas;
  }

  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(
    bitmap,
    -drawWidth / 2,
    -drawHeight / 2,
    drawWidth,
    drawHeight,
  );

  if (options.invert || options.contrast) {
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;

    for (let i = 0; i < data.length; i += 4) {
      let value =
        (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;

      if (options.contrast) {
        value = Math.min(255, Math.max(0, (value - 128) * 1.7 + 128));
      }
      if (options.invert) {
        value = 255 - value;
      }

      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }

    context.putImageData(image, 0, 0);
  }

  return canvas;
}

async function canvasToFile(
  canvas: HTMLCanvasElement,
  name: string,
): Promise<File | null> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );

  if (!blob) return null;

  return new File([blob], name, { type: "image/png" });
}

type ScanCandidate = ProcessOptions & { scale?: number };

const BASE_SETTINGS: ScanCandidate[] = [
  { rotation: 0 },
  { rotation: 90 },
  { rotation: 270 },
  { rotation: 0, contrast: true },
  { rotation: 0, contrast: true, invert: true },
  { rotation: 0, invert: true },
  { rotation: 180 },
  { rotation: 90, contrast: true },
];

const UPSCALE_SETTINGS: ScanCandidate[] = [
  { rotation: 0 },
  { rotation: 90 },
  { rotation: 0, contrast: true },
];

function buildCandidates(maxSide: number): ScanCandidate[] {
  const candidates: ScanCandidate[] = [...BASE_SETTINGS];

  if (maxSide < 2200) {
    for (const settings of UPSCALE_SETTINGS) {
      candidates.push({ ...settings, scale: 2 });
    }
  }
  if (maxSide < 1400) {
    for (const settings of UPSCALE_SETTINGS) {
      candidates.push({ ...settings, scale: 3 });
    }
  }

  return candidates;
}

async function scanImageFile(
  scanner: Html5Qrcode,
  file: File,
): Promise<string> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });

  let lastError: unknown = new Error("No se pudo decodificar la imagen.");

  try {
    const maxSide = Math.max(bitmap.width, bitmap.height);

    for (const options of buildCandidates(maxSide)) {
      const canvas = processCanvas(bitmap, options);
      const candidate = await canvasToFile(canvas, file.name);

      if (!candidate) continue;

      try {
        return await scanner.scanFile(candidate, false);
      } catch (error) {
        lastError = error;
      }
    }
  } finally {
    bitmap.close();
  }

  throw lastError;
}

export default function App() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileScannerRef = useRef<Html5Qrcode | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileScanning, setFileScanning] = useState(false);
  const [fileError, setFileError] = useState("");

  useEffect(() => {
    return () => {
      const scanner = scannerRef.current;

      if (scanner?.isScanning) {
        void scanner.stop().catch(console.error);
      }
    };
  }, []);

  useEffect(() => {
    if (result || fileError) {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [result, fileError]);

  const startScanner = async () => {
    if (scannerRef.current?.isScanning) return;

    setError("");
    setResult("");

    const scanner = new Html5Qrcode("reader", {
      formatsToSupport: FORMATS,
      verbose: false,
    });

    scannerRef.current = scanner;

    try {
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (width, height) => ({
            width: Math.floor(width * 0.85),
            height: Math.floor(height * 0.45),
          }),
          aspectRatio: 1.5,
        },
        (decodedText) => {
          setResult(decodedText);
        },
        () => {
          // No se detectó ningún código en este fotograma.
        },
      );

      setScanning(true);
    } catch (err) {
      console.error(err);

      setError(
        "No se pudo iniciar la cámara. Verifica los permisos y que esté disponible.",
      );

      try {
        if (scanner.isScanning) {
          await scanner.stop();
        }
        scanner.clear();
      } catch {
        // Puede que la cámara no llegara a iniciarse.
      }

      if (scannerRef.current === scanner) {
        scannerRef.current = null;
      }

      setScanning(false);
    }
  };

  const stopScanner = async () => {
    const scanner = scannerRef.current;

    if (scanner) {
      try {
        if (scanner.isScanning) {
          await scanner.stop();
        }
        scanner.clear();
      } catch (err) {
        console.error(err);
      }
    }

    scannerRef.current = null;
    setScanning(false);
  };

  const scanImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) return;

    setError("");
    setFileError("");
    setResult("");
    setFileName(file.name);
    setFileScanning(true);

    const scanner =
      fileScannerRef.current ??
      new Html5Qrcode("file-reader", {
        formatsToSupport: FORMATS,
        verbose: false,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      });

    fileScannerRef.current = scanner;

    try {
      const decodedText = await scanImageFile(scanner, file);

      setResult(decodedText);
    } catch (err) {
      console.error(err);

      setFileError(
        "No se detectó ningún código en la imagen. Prueba con otra imagen más nítida, con mejor iluminación o sin recortar el código.",
      );
    } finally {
      setFileScanning(false);
      event.target.value = "";
    }
  };

  const copyResult = async () => {
    try {
      await navigator.clipboard.writeText(result);
    } catch (err) {
      console.error(err);
      setError("No se pudo copiar el contenido al portapapeles.");
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-xl space-y-6">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">
            Scanner de códigos
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Escanea códigos de barras o códigos QR con tu cámara.
          </p>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div id="reader" className="w-full overflow-hidden rounded-xl" />

          <div className="mt-4 flex flex-wrap gap-3">
            {!scanning ? (
              <button
                type="button"
                onClick={startScanner}
                className="rounded-lg bg-blue-600 px-5 py-3 font-medium text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Iniciar escáner
              </button>
            ) : (
              <button
                type="button"
                onClick={stopScanner}
                className="rounded-lg bg-red-600 px-5 py-3 font-medium text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              >
                Detener escáner
              </button>
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Escanear desde una imagen</h2>
          <p className="mt-1 text-sm text-slate-600">
            Sube una foto o captura que contenga un código de barras o QR.
          </p>

          <div id="file-reader" className="hidden" />

          <label
            className={`mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
              fileScanning
                ? "cursor-wait border-blue-400 bg-blue-50"
                : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50"
            }`}
          >
            <span className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white">
              {fileScanning && (
                <svg
                  className="h-5 w-5 animate-spin text-white"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              )}
              {fileScanning ? "Procesando imagen…" : "Seleccionar imagen"}
            </span>
            <span className="text-sm text-slate-500">
              {fileScanning
                ? "Buscando el código, espera un momento…"
                : fileName || "PNG, JPG o cualquier formato de imagen"}
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={scanImage}
              disabled={fileScanning}
              className="hidden"
            />
          </label>

          {fileError && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
            >
              {fileError}
            </p>
          )}
        </section>

        <section
          ref={resultRef}
          className={`rounded-2xl border bg-white p-5 shadow-sm transition ${
            result ? "border-green-300 ring-2 ring-green-200" : "border-slate-200"
          }`}
        >
          <h2 className="text-lg font-semibold">Contenido detectado</h2>

          {result ? (
            <div className="mt-3 space-y-4">
              <p className="flex items-center gap-2 text-sm font-medium text-green-700">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
                Código detectado
              </p>

              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-100 p-4 text-sm">
                {result}
              </pre>

              <button
                type="button"
                onClick={copyResult}
                className="rounded-lg bg-slate-800 px-4 py-2.5 font-medium text-white transition hover:bg-slate-700"
              >
                Copiar contenido
              </button>
            </div>
          ) : (
            <p className="mt-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">
              El contenido aparecerá aquí cuando se detecte un código.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
