import mongoose from "mongoose";

const ngoSchema=  new mongoose.Schema({
  user:{
    type:mongoose.Schema.Types.ObjectId,
    ref:"User",
    required:true,
    unique:true,
  },
  // 2. Organization Details
        organizationName: {
            type: String,
            required: [true, "Organization name is required"],
            trim: true,
        },
        registrationNumber: {
            type: String,
            required: [true, "Registration number is required"],
            unique: true,
        },
        description: {
            type: String,
            required:true,
            maxLength: 1000,
        },
        // 3. Location Data (Crucial for the "Nearby NGOs" feature later)
        address: {
            street: String,
            city: { type: String, required: true },
            state: { type: String, required: true },
            pinCode: String,
        },
        // Add this inside your NGO schema (maybe right below address)
location: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number] }, // [longitude, latitude]
},
        // 4. Operational Information
        animalsHandled: {
            type: [String], // e.g., ["Dogs", "Cats", "Cattle"]
            required: true,
        },
        servicesProvided: {
            type: [String], // e.g., ["Rescue", "Shelter", "Ambulance"]
            required: true,
        },
        // 5. Verification Documents (These will store Cloudinary URLs later)
       documents: {
    registrationCertificate: {
        type: String,
        required: true
    },
    panCard: {
        type: String,
        required: true
    },
    twelveACertificate: String,
    eightyGCertificate: String,
},
        // 6. The Core Trust Architecture Switch
        verificationStatus: {
            type: String,
            enum: ["pending", "verified", "rejected"],
            default: "pending", // Always starts as pending until Admin approves
        },
           verifiedAt: Date,
            rejectionReason: String,
},{timestamps:true})

// This tells MongoDB to index the earth as a sphere for accurate distance math
ngoSchema.index({ location: "2dsphere" });
export const Ngo= mongoose.model("Ngo", ngoSchema);
