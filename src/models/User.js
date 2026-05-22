import mongoose from "mongoose";

/** Canonical RBAC roles (MongoDB enum) */
export const USER_ROLES = Object.freeze({
  SUPER_ADMIN: "SuperAdmin",
  SELLER: "Seller",
  CUSTOMER: "Customer",
});

const FAMILY_RELATIONSHIPS = Object.freeze([
  "self",
  "spouse",
  "child",
  "parent",
  "grandparent",
  "other",
]);

const familyMemberSchema = new mongoose.Schema(
  {
    relationship: {
      type: String,
      enum: FAMILY_RELATIONSHIPS,
      default: "other",
    },
    display_name: { type: String, default: "", trim: true, maxlength: 80 },
    date_of_birth: { type: Date, default: null },
    age_years: { type: Number, default: null, min: 0, max: 125 },
  },
  { _id: true, timestamps: false }
);

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    username: { type: String, unique: true, sparse: true, trim: true },
    name: { type: String, required: true, trim: true },
    googleSub: { type: String, unique: true, sparse: true, trim: true },
    picture: { type: String, default: "" },
    passwordHash: { type: String, default: null },
    role: {
      type: String,
      enum: [
        ...Object.values(USER_ROLES),
        "grand_admin",
        "vendor_admin",
        "customer",
      ],
      required: true,
      default: USER_ROLES.CUSTOMER,
    },
    /** Sellers: Kiran must approve before login / import */
    isApproved: { type: Boolean, default: false },
    family_members: { type: [familyMemberSchema], default: [] },
    ksaCoins: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

userSchema.pre("save", function normalizeUserRole(next) {
  const map = {
    grand_admin: USER_ROLES.SUPER_ADMIN,
    vendor_admin: USER_ROLES.SELLER,
    customer: USER_ROLES.CUSTOMER,
  };
  if (map[this.role]) this.role = map[this.role];
  if (this.role === USER_ROLES.SUPER_ADMIN) this.isApproved = true;
  next();
});

export const User = mongoose.models.User || mongoose.model("User", userSchema);
