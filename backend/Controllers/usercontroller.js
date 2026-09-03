import {User} from "../Models/usermodel.js"
import { generateAccessToken,generateRefreshToken } from "../Utils/generatetoken.js"
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import validator from "validator";

export const registerUser= asyncHandler(async(req,res) => {
 const { name, email, password, phone, role } = req.body;
   if ([name, email, password, phone].some((field) => field?.trim() === "")) {
        throw new ApiError(400, "All fields are required");
    }
if (!validator.isEmail(email)) {
    throw new ApiError(400, "Invalid email");
}

if (!validator.isMobilePhone(phone, "any")) {
    throw new ApiError(400, "Invalid phone number");
}

if(password.length<8){
  throw new ApiError(400,"Password should contain min 8 characters")
}

if (!validator.isStrongPassword(password)) {
    throw new ApiError(400, "Password is not strong enough");
}

const userExists = await User.findOne({ email });

if(userExists){
      throw new ApiError(409, "User already exists with this email");
}

const user = await User.create({
        name,
        email,
        password,
        phone,
        role: "user"
});

// Verify if user was created successfully
const createdUser = await User.findById(user._id).select("-password");

if (!createdUser) {
        throw new ApiError(500, "Something went wrong while registering the user");
    }
// Generate both tokens
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // Set Refresh Token in HTTP-Only Cookie
    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV !== "development",
        sameSite: "strict",
        maxAge: 30 * 24 * 60 * 60 * 1000,
    };

    res.status(201)
        .cookie("jwt_refresh", refreshToken, options)
        .json(
            new ApiResponse(201, { user: createdUser, accessToken }, "User registered successfully")
        );
});

export const loginuser = asyncHandler( async (req,res)=>{
    const {email , password}= req.body
    if(!email || !password){
        throw new ApiError(400,"Email and Password are required");
    }
    if (!validator.isEmail(email)) {
    throw new ApiError(400, "Invalid email");
}

if(password.length<8){
  throw new ApiError(400,"Password should contain min 8 characters")
}

const user = await User.findOne({email});
if(!user){
    throw new ApiError(404,"User does not exist");
}
 const isPasswordvalid = await user.matchPassword(password);

 if(!isPasswordvalid){
        throw new ApiError(401,"Invalid Credentials");

 }
 
// Generate both tokens
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

        // Set Refresh Token in HTTP-Only Cookie
    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV !== "development",
        sameSite: "strict",
        maxAge: 30 * 24 * 60 * 60 * 1000,
    };

    const loggedinUser = await User.findById(user._id).select("-password");

    res.status(200)
    .cookie("jwt_refresh", refreshToken , options)
    .json(
        new ApiResponse(200 , { user: loggedinUser , accessToken } , "User logged in successfully" )
    )

});

export const logoutUser = asyncHandler (async (req,res) =>{
      const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV !== "development",
        sameSite: "strict",
    };

    res.status(200)
    .clearCookie("jwt_refresh" , options)
    .json(
        new ApiResponse(200 , {} , "User logged out successfully")
    )

    
});
export const getUserImpactProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    // 1. Fetch Emergencies Reported by User
    const emergencies = await EmergencyCase.find({ reporter: userId })
        .populate("assignedNgo", "organizationName")
        .select("species status createdAt");

    // 2. Fetch Fulfilled Supply Pledges
    const supplies = await SupplyRequest.find({
        "pledges.user": userId,
        "pledges.status": "Received"
    }).populate("ngo", "organizationName")
      .select("title pledges createdAt");

    // 3. Fetch Successful Donations
    const donations = await DonationCampaign.find({
        "donors.user": userId
    }).populate("ngo", "organizationName")
      .select("title donors createdAt");

    // 4. Standardize the data into a single Timeline Array
    let timeline = [];

    emergencies.forEach(emp => {
        timeline.push({
            type: "Emergency",
            title: `Reported an injured ${emp.species}`,
            ngoName: emp.assignedNgo ? emp.assignedNgo.organizationName : "Pending NGO",
            status: emp.status,
            date: emp.createdAt
        });
    });

    supplies.forEach(sup => {
        // Find the specific pledge for this user
        const userPledge = sup.pledges.find(p => String(p.user) === String(userId));
        if (userPledge) {
            timeline.push({
                type: "Supply",
                title: `Donated ${userPledge.quantity} units for: ${sup.title}`,
                ngoName: sup.ngo.organizationName,
                date: userPledge.pledgedAt
            });
        }
    });

    donations.forEach(camp => {
        const userDonation = camp.donors.find(d => String(d.user) === String(userId));
        if (userDonation) {
            timeline.push({
                type: "Donation",
                title: `Funded ₹${userDonation.amount} towards: ${camp.title}`,
                ngoName: camp.ngo.organizationName,
                date: userDonation.donatedAt
            });
        }
    });

    // Sort the entire timeline from newest to oldest
    timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

    return res.status(200).json(
        new ApiResponse(200, {
            lifetimeStats: req.user.impact,
            timeline
        }, "User impact profile generated.")
    );
});