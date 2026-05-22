import mongoose from "mongoose";
import { Order } from "../models/Order.js";
import {
  createAftershipTracking,
  fetchAftershipTracking,
  mergeCarrierTimeline,
  buildProcessingTimeline,
} from "../services/tracking/aftershipService.js";

function resolveTrackingFields(order) {
  const ship = order.shipmentTracking || {};
  const trackingNumber = String(
    order.trackingNumber || ship.trackingNumber || ""
  ).trim();
  const courierCode = String(
    order.courierCode || ship.aftershipSlug || ""
  ).trim();
  const carrierName = String(ship.carrierName || "").trim();
  return { ship, trackingNumber, courierCode, carrierName };
}

async function buildTrackingPayload(order) {
  const { ship, trackingNumber, courierCode, carrierName } = resolveTrackingFields(order);
  let carrierTag = ship.lastTag || "Processing";
  let timeline = buildProcessingTimeline(order.vip_tracking_step ?? 0);
  let source = "processing";

  if (trackingNumber) {
    const live = await fetchAftershipTracking({
      slug: courierCode || undefined,
      trackingNumber,
    });
    if (live.ok) {
      carrierTag = live.tag || carrierTag;
      timeline = mergeCarrierTimeline(live.checkpoints, order.vip_tracking_step ?? 0);
      source = "aftership";
    } else if (ship.checkpoints?.length) {
      timeline = mergeCarrierTimeline(ship.checkpoints, order.vip_tracking_step ?? 0);
      source = "cached";
    }
  } else if (ship.checkpoints?.length) {
    timeline = mergeCarrierTimeline(ship.checkpoints, order.vip_tracking_step ?? 0);
    source = "cached";
  }

  return {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    ksaSerialGlobal: order.ksaSerialGlobal,
    status: order.status,
    vipStep: order.vip_tracking_step ?? 0,
    carrier: carrierName || courierCode || "",
    courierCode: courierCode || null,
    trackingNumber: trackingNumber || null,
    carrierTag,
    timeline,
    trackingSource: source,
    hasLiveTracking: Boolean(trackingNumber),
    createdAt: order.createdAt,
  };
}

/**
 * Register parcel with AfterShip and persist on the order (admin fulfilment).
 * @param {import("mongoose").Document} order
 * @param {{ trackingNumber: string, courierCode?: string, carrierName?: string }} input
 */
export async function registerOrderShipmentWithAftership(order, input) {
  const trackingNumber = String(input.trackingNumber || "").trim();
  const courierCode = String(
    input.courierCode || input.slug || input.aftershipSlug || ""
  ).trim();
  const carrierName = String(input.carrierName || input.carrier || "").trim();

  if (!trackingNumber) {
    const err = new Error("trackingNumber is required");
    err.status = 400;
    throw err;
  }

  let checkpoints = [];
  let lastTag = "Processing";
  let aftershipId = "";
  let aftershipSlug = courierCode;

  const created = await createAftershipTracking({
    trackingNumber,
    slug: aftershipSlug || undefined,
    orderNumber: order.orderNumber,
  });
  if (created.ok) {
    aftershipId = created.id;
    aftershipSlug = created.slug || aftershipSlug;
    checkpoints = created.checkpoints || [];
    lastTag = created.tag || lastTag;
  } else {
    const live = await fetchAftershipTracking({
      trackingNumber,
      slug: aftershipSlug || undefined,
    });
    if (live.ok) {
      aftershipId = live.id;
      aftershipSlug = live.slug || aftershipSlug;
      checkpoints = live.checkpoints || [];
      lastTag = live.tag || lastTag;
    }
  }

  order.trackingNumber = trackingNumber;
  order.courierCode = aftershipSlug;
  order.shipmentTracking = {
    carrierName,
    trackingNumber,
    aftershipId,
    aftershipSlug,
    lastTag,
    lastSyncedAt: new Date(),
    checkpoints,
  };
  if (order.vip_tracking_step < 3) order.vip_tracking_step = 3;
  order.markModified("shipmentTracking");
  await order.save();

  try {
    const { sendShippingUpdateEmail } = await import("../services/email/emailService.js");
    await sendShippingUpdateEmail(order._id);
  } catch (err) {
    console.warn("[registerOrderShipment] shipping email:", err.message);
  }

  return {
    trackingNumber: order.trackingNumber,
    courierCode: order.courierCode,
    shipmentTracking: order.shipmentTracking,
    vip_tracking_step: order.vip_tracking_step,
  };
}

/**
 * Public order tracking — order number or KSA serial + optional email verification.
 * GET /api/tracking?orderNumber=KSA-...&email=...
 */
export async function getPublicOrderTracking(req, res, next) {
  try {
    const orderNumber = String(req.query.orderNumber || req.query.order || "").trim();
    const serial = String(req.query.serial || req.query.ksaSerial || "").trim();
    const email = String(req.query.email || "").trim().toLowerCase();

    if (!orderNumber && !serial) {
      return res.status(400).json({ message: "Provide orderNumber or serial (ksaSerial)." });
    }

    const query = orderNumber ? { orderNumber } : { ksaSerialGlobal: serial };
    const order = await Order.findOne(query)
      .populate("customer", "email name")
      .select(
        "orderNumber ksaSerialGlobal status vip_tracking_step trackingNumber courierCode shipmentTracking compliance.prescriptionReviewRequired createdAt"
      )
      .lean();

    if (!order) {
      return res.status(404).json({ message: "Order not found. Check your order number and try again." });
    }

    if (email && order.customer?.email) {
      const cust = String(order.customer.email).toLowerCase();
      if (!cust.includes(email) && !cust.endsWith(email)) {
        return res.status(403).json({ message: "Email does not match this order." });
      }
    }

    res.json(await buildTrackingPayload(order));
  } catch (err) {
    next(err);
  }
}

/**
 * Public tracking by MongoDB id, order number, or KSA serial — for /track-order/:id
 * GET /api/tracking/:id
 */
export async function getOrderTrackingById(req, res, next) {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      return res.status(400).json({ message: "Order id or reference is required." });
    }

    let order = null;
    if (mongoose.isValidObjectId(id)) {
      order = await Order.findById(id)
        .select(
          "orderNumber ksaSerialGlobal status vip_tracking_step trackingNumber courierCode shipmentTracking createdAt"
        )
        .lean();
    }
    if (!order) {
      order = await Order.findOne({
        $or: [{ orderNumber: id }, { ksaSerialGlobal: id }],
      })
        .select(
          "orderNumber ksaSerialGlobal status vip_tracking_step trackingNumber courierCode shipmentTracking createdAt"
        )
        .lean();
    }

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    res.json(await buildTrackingPayload(order));
  } catch (err) {
    next(err);
  }
}

/**
 * Customer JWT — track own order by id.
 */
export async function getMyOrderTracking(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const order = await Order.findOne({ _id: id, customer: req.user._id })
      .select(
        "orderNumber ksaSerialGlobal status vip_tracking_step trackingNumber courierCode shipmentTracking createdAt"
      )
      .lean();

    if (!order) return res.status(404).json({ message: "Order not found" });

    res.json(await buildTrackingPayload(order));
  } catch (err) {
    next(err);
  }
}

/**
 * Admin — register tracking number with AfterShip.
 * PATCH /api/admin/orders/:orderId/shipment-tracking
 */
export async function patchOrderShipmentTracking(req, res, next) {
  try {
    const { orderId } = req.params;
    if (!mongoose.isValidObjectId(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }

    const trackingNumber = String(req.body?.trackingNumber || "").trim();
    const courierCode = String(
      req.body?.courierCode || req.body?.slug || req.body?.aftershipSlug || ""
    ).trim();
    const carrierName = String(req.body?.carrierName || req.body?.carrier || "").trim();

    if (!trackingNumber) {
      return res.status(400).json({ message: "trackingNumber is required" });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const result = await registerOrderShipmentWithAftership(order, {
      trackingNumber,
      courierCode,
      carrierName,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}
