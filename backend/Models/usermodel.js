import mongoose from "mongoose";
import bcrypt from "bcrypt";

const userSchema= new mongoose.Schema({
   name:{
    type:String,
    required:[true,"Please add a name"],
   },
    email:{
    type:String,
    required:[true,"Please add an email"],
    unique:true,
    trim:true,
    lowercase:true,
   },
    password:{
    type:String,
    required:[true,"Please add a password"],
    minlength:6,
   },
   phone:{
    type:String,
   required: [true, "Please add a phone number"],
   },
   role: {
            type: String,
            enum: ["user", "ngo", "admin", "vet"],
            default: "user",
        },
   // Account moderation (Batch 5). Suspension blocks login and all
   // authenticated actions (enforced in auth middleware, login and
   // refresh). A temporary suspension has a suspendedUntil date and
   // expires on its own; an indefinite suspension has no date and stays
   // until an admin lifts it. Suspension never hides the user's content
   // on its own: content removal is a separate moderation action.
   accountStatus: {
            type: String,
            enum: ["Active", "Suspended"],
            default: "Active",
   },
   suspendedUntil: Date,
   suspensionReason: String,
   // SHA-256 hash of the current refresh token, or null when logged out.
   // Only one refresh token is active per user at a time: logging in or
   // refreshing on one device replaces the token from another device.
   // select: false keeps the hash out of normal user queries.
   refreshTokenHash: {
            type: String,
            default: null,
            select: false,
   },
impact: {
    rescuesReported: { type: Number, default: 0 },
    suppliesDonated: { type: Number, default: 0 },
    campaignsFunded: { type: Number, default: 0 },
    volunteerHours: { type: Number, default: 0 }
}
},{timestamps:true});

// Batch 5 fix: this hook previously took a `next` argument in an async
// function, so saving an existing user without changing the password
// threw "next is not a function" (it also fell through and re-hashed
// the password). An async pre-save hook takes no `next`: returning
// early when the password is unchanged is the correct behaviour, and
// it is what account suspension (which saves the user without touching
// the password) depends on.
userSchema.pre("save", async function(){
  if(!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password , salt);
});

userSchema.methods.matchPassword = async function(enteredPassword) {
   return await bcrypt.compare(enteredPassword, this.password);
};

export const  User= mongoose.model('User',userSchema);