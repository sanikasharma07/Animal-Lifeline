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

const SupplyRequest = mongoose.model("SupplyRequest", supplyRequestSchema);