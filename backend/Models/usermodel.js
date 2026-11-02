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

userSchema.pre("save", async function(next){
  if(!this.isModified("password")) next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password , salt);
});

userSchema.methods.matchPassword = async function(enteredPassword) {
   return await bcrypt.compare(enteredPassword, this.password);
};

export const  User= mongoose.model('User',userSchema);