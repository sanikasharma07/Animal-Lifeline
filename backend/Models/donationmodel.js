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
                transactionId: { type: String }, // Razorpay payment id
                orderId: { type: String }, // Razorpay order id, pushed by verifyDonation / razorpayWebhook
                donatedAt: { type: Date, default: Date.now }
            }
        ],
        status: {
            type: String,
            enum: ["Active", "Goal Reached", "Closed"],
            default: "Active",
        },

        // Soft removal by an admin (Batch 5). Removed content is excluded
        // from public listings and normal access, but the document, its
        // ownership and its history (donors, pledges, applications) are
        // preserved, and an admin can restore it. Hard deletion is never
        // used for moderation removal.
        removedByAdmin: { type: Boolean, default: false },
        removalReason: String,
        impact: {
            photos: [{ type: String }], // Cloudinary URLs (e.g., vet bills, recovered animal)
            message: { type: String }, // e.g., "Rocky's surgery was a success! Here is the vet bill."
            uploadedAt: { type: Date }
        }
    },
    { timestamps: true }
);

export const DonationCampaign = mongoose.model("DonationCampaign", donationCampaignSchema);