import mongoose from "mongoose";

const donationCampaignSchema = new mongoose.Schema(
    {
        ngo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Ngo",
            required: true,
        },
        title: {
            type: String,
            required: true, // e.g., "Emergency Leg Surgery for Rocky"
        },
        description: {
            type: String,
            required: true,
        },
        targetAmount: {
            type: Number,
            required: true,
        },
        raisedAmount: {
            type: Number,
            default: 0,
        },
        // Track the users who actually paid
        donors: [
            {
                user: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "User",
                },
                amount: { type: Number, required: true },
                transactionId: { type: String }, // For Razorpay/Stripe tracking later
                donatedAt: { type: Date, default: Date.now }
            }
        ],
        status: {
            type: String,
            enum: ["Active", "Goal Reached", "Closed"],
            default: "Active",
        },
        impact: {
            photos: [{ type: String }], // Cloudinary URLs (e.g., vet bills, recovered animal)
            message: { type: String }, // e.g., "Rocky's surgery was a success! Here is the vet bill."
            uploadedAt: { type: Date }
        }
    },
    { timestamps: true }
);

export const DonationCampaign = mongoose.model("DonationCampaign", donationCampaignSchema);