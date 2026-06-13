#!/usr/bin/env node
// Pin an image to IPFS via Pinata and print its CID.
//
// This does two jobs. As a CLI it gives you a CID to feed the live vision test:
//
//   PINATA_JWT=... node deploy/pin-evidence.mjs ./some-screenshot.png
//   # -> prints the CID, then:
//   INTEGRATION_EVIDENCE_CID=<cid> .venv/bin/gltest tests/integration -m slow -v -s --network studionet
//
// And `pinEvidence(bytes, filename)` is the exact call the app's upload route
// makes when a player attaches a screenshot to an appeal: take the uploaded
// bytes, pin them, hand the CID to file_appeal. The JWT is a secret, so this
// must run server-side (a Vercel function / API route), never in the browser.

const PINATA_ENDPOINT = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const MAX_BYTES = 5 * 1024 * 1024; // mirror the contract's cap so we reject early
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export async function pinEvidence(bytes, filename = "evidence", contentType = "image/png") {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error("PINATA_JWT is not set");
  if (!ALLOWED.has(contentType)) throw new Error(`unsupported content type: ${contentType}`);
  if (bytes.length === 0) throw new Error("evidence is empty");
  if (bytes.length > MAX_BYTES) throw new Error("evidence exceeds the 5 MiB cap");

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: contentType }), filename);
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

  const res = await fetch(PINATA_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`pinata pin failed: ${res.status} ${await res.text()}`);
  }
  const { IpfsHash } = await res.json();
  return IpfsHash; // the bare CID; file_appeal wants exactly this
}

// CLI entrypoint
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: PINATA_JWT=... node deploy/pin-evidence.mjs <image-file>");
    process.exit(1);
  }
  const { readFile } = await import("node:fs/promises");
  const { extname, basename } = await import("node:path");
  const ext = extname(path).toLowerCase();
  const typeByExt = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  const contentType = typeByExt[ext];
  if (!contentType) {
    console.error(`unsupported file extension: ${ext} (png/jpg/jpeg/gif/webp)`);
    process.exit(1);
  }
  try {
    const bytes = await readFile(path);
    const cid = await pinEvidence(bytes, basename(path), contentType);
    console.log(cid);
    console.error(`pinned ${path} -> ipfs://${cid}`);
    console.error(`gateway: https://ipfs.io/ipfs/${cid}`);
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(1);
  }
}
