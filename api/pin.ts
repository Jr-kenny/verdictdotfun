// Vercel serverless function: pin an image data URL to IPFS via Pinata, return a bare CID.
// Used by the Sketch & Guess mode so players can upload a drawing and get a content-addressed
// CID the contract can fetch. Requires the PINATA_JWT environment variable; without it the
// route returns 501 and the UI falls back to manual CID entry.

type Req = { method?: string; body?: unknown };
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
};

export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    res.status(501).json({ error: "Pinning is not configured (PINATA_JWT unset). Paste a CID manually." });
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
    form.append("file", new Blob([bytes], { type: mime }), `sketch.${ext}`);

    const pinRes = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    });

    if (!pinRes.ok) {
      const text = await pinRes.text();
      res.status(502).json({ error: `Pinata error: ${text.slice(0, 200)}` });
      return;
    }

    const out = (await pinRes.json()) as { IpfsHash?: string };
    if (!out.IpfsHash) {
      res.status(502).json({ error: "Pinata did not return a hash." });
      return;
    }
    res.status(200).json({ cid: out.IpfsHash });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Pin failed." });
  }
}

function safeParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
