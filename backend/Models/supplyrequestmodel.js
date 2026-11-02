import mongoose from "mongoose"

const supplyRequestSchema = new mongoose.Schema({
    ngo :{
        type: mongoose.Schema.Types.ObjectId , 
        ref: "Ngo",
        required: true,
    },
    title: { type: String, required: true },
        description: { type: String, required: true },
        category: {
            type: String,
            enum: ["Food", "Medicine", "Accessories", "Other"],
            required: true,
        },
        // The Math Module
        requiredQuantity: { type: Number, required: true },
        receivedQuantity: { type: Number, default: 0 },
        unit: { type: String, required: true }, // e.g., "kg", "packets", "liters"

        // The Pledge Tracking Pipeline
        pledges: [
            {
                user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
                pledgedQuantity: { type: Number, required: true },
                message: { type: String },
                status: {
                    type: String,
                    enum: ["Pledged", "Contacted", "Delivery Arranged", "Received", "Cancelled"],
                    default: "Pledged",
                },
                pledgedAt: { type: Date, default: Date.now },
            }
        ],


        // Soft removal by an admin (Batch 5). Removed content is excluded
        // from public listings and normal access, but the document, its
        // ownership and its history (donors, pledges, applications) are
        // preserved, and an admin can restore it. Hard deletion is never
        // used for moderation removal.
        removedByAdmin: { type: Boolean, default: false },
        removalReason: String,
        // Request Status
        status: {
            type: String,
            enum: ["Open", "Fulfilled"],
            default: "Open",
        },

        // The Impact Proof (Filled out later)
        impact: {
            photos: [{ type: String }], // Cloudinary URLs
            message: { type: String },
            uploadedAt: { type: Date }
        }
     
} , { timestamps: true });

export const SupplyRequest = mongoose.model("SupplyRequest", supplyRequestSchema);