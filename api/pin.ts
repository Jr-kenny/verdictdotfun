// Vercel serverless function: upload a drawing (image data URL) to the keyless catbox.moe
// file host and return its direct file URL. Used by Sketch & Guess so a player's drawing
// gets a public URL the contract can fetch. No API key required (anonymous upload), so unlike
// the previous Pinata/IPFS path this works out of the box. The contract only accepts URLs under
// https://files.catbox.moe/, which we also assert here before handing one back to the client.

type Req = { method?: string; body?: unknown };
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
};

const CATBOX_API = "https://catbox.moe/user/api.php";
const CATBOX_PREFIX = "https://files.catbox.moe/";

export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { dataUrl?: string } | undefined;
  const dataUrl = body?.dataUrl;
  if (!dataUrl || !dataUrl.startsWith("data:")) {
    res.status(400).json({ error: "Provide an image dataUrl." });
    return;
  }

  try {
    const comma = dataUrl.indexOf(",");
    const meta = dataUrl.slice(5, comma); // e.g. "image/png;base64"
    const mime = meta.split(";")[0] || "image/png";
    const isBase64 = meta.includes("base64");
    const bytes = isBase64
      ? Buffer.from(dataUrl.slice(comma + 1), "base64")
      : Buffer.from(decodeURIComponent(dataUrl.slice(comma + 1)));

    if (bytes.length > 5 * 1024 * 1024) {
      res.status(413).json({ error: "Image exceeds the 5 MiB limit." });
      return;
    }

    const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "png";
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", new Blob([bytes], { type: mime }), `sketch.${ext}`);

    const uploadRes = await fetch(CATBOX_API, { method: "POST", body: form });
    const text = (await uploadRes.text()).trim();

    if (!uploadRes.ok || !text.startsWith(CATBOX_PREFIX)) {
      res.status(502).json({ error: `Upload host error: ${text.slice(0, 200) || `status ${uploadRes.status}`}` });
      return;
    }
    res.status(200).json({ url: text });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Upload failed." });
  }
}

function safeParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
