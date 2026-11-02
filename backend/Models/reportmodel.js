import mongoose from "mongoose";

// A user report about suspicious activity or content. Evidence uploads
// are deliberately NOT part of Batch 5: a written explanation is required
// instead. The reporter is visible to admins only, never to the reported
// user or organisation (there is no endpoint that exposes a report to
// anyone except its reporter and admins).
const reportSchema = new mongoose.Schema({
    reporter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
    },
    targetType: {
        type: String,
        required: true,
        enum: ["User", "Ngo", "Vet", "DonationCampaign", "SupplyRequest", "EmergencyCase", "Animal", "VolunteerRequest", "VolunteerStory"],
    },
    targetId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: "targetType",
        index: true,
    },
    reason: {
        type: String,
        required: true,
        enum: [
            "Fake NGO",
            "Fake fundraising campaign",
            "Misleading information",
            "Suspicious donation activity",
            "False emergency",
            "Misuse of platform",
            "Animal welfare concern",
            "Other",
        ],
    },
    explanation: {
        type: String,
        required: [true, "A written explanation is required."],
        trim: true,
        maxLength: 2000,
    },
    status: {
        type: String,
        enum: ["Pending", "Under Review", "Resolved", "Dismissed"],
        default: "Pending",
    },
    adminNote: String,
    // What enforcement, if any, was taken for this report. Enforcement
    // itself is performed through the moderation endpoints, which create
    // AdminAction records; this field is the report's summary of it.
    actionTaken: {
        type: String,
        enum: ["None", "Warning", "Temporary Suspension", "Indefinite Suspension", "Campaign Removal", "Content Removal", "Escalation"],
        default: "None",
    },
    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    },
    reviewedAt: Date,
}, { timestamps: true });

// Duplicate prevention at the database level as well as in the
// controller: one reporter cannot have two open reports for one target.
// (A new report after the old one is Resolved/Dismissed is allowed, and
// is a new row, so the unique index cannot cover status directly; the
// controller enforces the open-report rule. This index speeds that check.)
reportSchema.index({ reporter: 1, targetType: 1, targetId: 1, status: 1 });
export const Report = mongoose.model("Report", reportSchema);
