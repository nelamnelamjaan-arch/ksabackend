/**
 * AfterShip — global parcel tracking (Amazon, AliExpress, DHL, etc.)
 * @see https://www.aftership.com/docs/tracking
 */

import axios from "axios";
import { getAftershipApiKey } from "../../config/envKeys.js";

const AFTERSHIP_API = "https://api.aftership.com/tracking/2025-04";

function authHeaders() {
  const key = getAftershipApiKey();
  if (!key) return null;
  return {
    "Content-Type": "application/json",
    "aftership-api-key": key,
  };
}

/**
 * @param {{ trackingNumber: string, slug?: string, orderNumber?: string }} input
 */
export async function createAftershipTracking(input) {
  const headers = authHeaders();
  if (!headers) return { ok: false, reason: "not_configured" };

  const trackingNumber = String(input.trackingNumber || "").trim();
  if (!trackingNumber) return { ok: false, reason: "no_tracking_number" };

  try {
    const body = {
      tracking_number: trackingNumber,
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.orderNumber ? { order_number: input.orderNumber } : {}),
    };
    const res = await axios.post(`${AFTERSHIP_API}/trackings`, body, {
      headers,
      timeout: 15_000,
    });
    const data = res.data?.data;
    return {
      ok: true,
      id: data?.id || "",
      slug: data?.slug || input.slug || "",
      tag: data?.tag || "Pending",
      checkpoints: normalizeCheckpoints(data?.checkpoints),
    };
  } catch (e) {
    const msg = e.response?.data?.meta?.message || e.message || "AfterShip error";
    console.warn("[aftership/create]", msg);
    return { ok: false, reason: "api_error", message: msg };
  }
}

/**
 * @param {{ slug: string, trackingNumber: string }} input
 */
export async function fetchAftershipTracking(input) {
  const headers = authHeaders();
  if (!headers) return { ok: false, reason: "not_configured" };

  const slug = String(input.slug || "").trim();
  const trackingNumber = String(input.trackingNumber || "").trim();
  if (!trackingNumber) return { ok: false, reason: "no_tracking_number" };

  const path = slug
    ? `${AFTERSHIP_API}/trackings/${encodeURIComponent(slug)}/${encodeURIComponent(trackingNumber)}`
    : `${AFTERSHIP_API}/trackings/${encodeURIComponent(trackingNumber)}`;

  try {
    const res = await axios.get(path, { headers, timeout: 15_000 });
    const data = res.data?.data;
    return {
      ok: true,
      id: data?.id || "",
      slug: data?.slug || slug,
      tag: data?.tag || "Pending",
      subtag: data?.subtag || "",
      expectedDelivery: data?.expected_delivery || null,
      checkpoints: normalizeCheckpoints(data?.checkpoints),
    };
  } catch (e) {
    if (e.response?.status === 404) {
      return { ok: false, reason: "not_found" };
    }
    const msg = e.response?.data?.meta?.message || e.message || "AfterShip error";
    console.warn("[aftership/fetch]", msg);
    return { ok: false, reason: "api_error", message: msg };
  }
}

function normalizeCheckpoints(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => ({
      message: String(c?.message || c?.tag || "Update").trim(),
      location: String(c?.location || "").trim(),
      checkpointTime: c?.checkpoint_time || c?.created_at || null,
      tag: String(c?.tag || "").trim(),
    }))
    .filter((c) => c.message)
    .sort((a, b) => {
      const ta = a.checkpointTime ? new Date(a.checkpointTime).getTime() : 0;
      const tb = b.checkpointTime ? new Date(b.checkpointTime).getTime() : 0;
      return ta - tb;
    });
}

/** Branded fallback when no carrier tracking is registered yet */
export function buildProcessingTimeline(vipStep = 0) {
  const stages = [
    { key: "processing", label: "Processing", message: "Your order is being prepared at our sourcing hub." },
    { key: "sourcing", label: "Global sourcing", message: "We are securing your item from our international partner." },
    { key: "qc", label: "Quality check", message: "Authenticity and packaging inspection in progress." },
    { key: "transit", label: "In transit", message: "Your parcel is on the way to your delivery address." },
    { key: "delivered", label: "Delivered", message: "Enjoy your purchase — thank you for choosing KSA Store." },
  ];
  const active = Math.min(Math.max(0, vipStep), stages.length - 1);
  return stages.map((s, i) => ({
    ...s,
    status: i < active ? "completed" : i === active ? "active" : "upcoming",
    checkpointTime: null,
    location: "",
  }));
}

export function mergeCarrierTimeline(checkpoints, vipStep) {
  if (!checkpoints?.length) return buildProcessingTimeline(vipStep);
  return checkpoints.map((c, i, arr) => ({
    key: `cp-${i}`,
    label: c.tag || (i === arr.length - 1 ? "Latest" : "Update"),
    message: c.message,
    location: c.location,
    checkpointTime: c.checkpointTime,
    status: i === arr.length - 1 ? "active" : "completed",
  }));
}
