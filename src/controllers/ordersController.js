import mongoose from "mongoose";
import { Order } from "../models/Order.js";

function stripVault(doc) {
  if (!doc) return doc;
  const o = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  delete o.fulfillmentVault;
  return o;
}

export async function listMyOrders(req, res, next) {
  try {
    const orders = await Order.find({ customer: req.user._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json(orders.map(stripVault));
  } catch (e) {
    next(e);
  }
}

export async function getMyOrder(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const order = await Order.findOne({ _id: id, customer: req.user._id }).lean();
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(stripVault(order));
  } catch (e) {
    next(e);
  }
}
