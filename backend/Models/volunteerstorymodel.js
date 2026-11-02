import mongoose from "mongoose";

// "Our Heroes": a short impact story from a volunteer who was approved
// for an opportunity (see volunteercontroller for that gate). Stories are
// written by the volunteer, not by the NGO, and are listed newest first.
const volunteerStorySchema = new mongoose.Schema({
    volunteer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    ngo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Ngo",
        required: true,
    },
    opportunity: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "VolunteerRequest",
        default: null,
    },
    title: {
        type: String,
        required: [true, "A title is required"],
        trim: true,
    },
    story: {
        type: String,
        required: [true, "A story is required"],
        maxLength: 2000,
    },

        // Soft removal by an admin (Batch 5). Removed content is excluded
        // from public listings and normal access, but the document, its
        // ownership and its history (donors, pledges, applications) are
        // preserved, and an admin can restore it. Hard deletion is never
        // used for moderation removal.
        removedByAdmin: { type: Boolean, default: false },
        removalReason: String,
    photo: String,
}, { timestamps: true });
export const VolunteerStory = mongoose.model("VolunteerStory", volunteerStorySchema);
