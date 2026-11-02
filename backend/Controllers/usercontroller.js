import {User} from "../Models/usermodel.js"
import { EmergencyCase } from "../Models/emergencycase.js";
import { SupplyRequest } from "../Models/supplyrequestmodel.js";
import { DonationCampaign } from "../Models/donationmodel.js";
import { generateAccessToken,generateRefreshToken, hashRefreshToken } from "../Utils/generatetoken.js"
import jwt from "jsonwebtoken";
import { ApiError } from "../Utils/ApiError.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import { asyncHandler } from "../Utils/asynchandler.js";
import validator from "validator";
import { assertNotSuspended } from "../Utils/accountStatus.js";

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
    // Remember only the hash, so this token can be rotated and revoked.
    await User.findByIdAndUpdate(user._id, { refreshTokenHash: hashRefreshToken(refreshToken) });

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

 // Suspended users cannot log in, and no new tokens are issued to them.
 // (An expired temporary suspension is lifted by this same check.)
 await assertNotSuspended(user);
 
// Generate both tokens
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    // Remember only the hash, so this token can be rotated and revoked.
    // Logging in here replaces any refresh token from another device.
    await User.findByIdAndUpdate(user._id, { refreshTokenHash: hashRefreshToken(refreshToken) });

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

    // Revoke the refresh token, if one was sent, so it cannot be used
    // to get a new access token after logout - even if the access token
    // has already expired (which is why logout no longer requires it).
    // Logout always succeeds and clears the cookie, even with no token.
    const refreshToken = req.cookies?.jwt_refresh;
    if (refreshToken) {
        try {
            const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
            const user = await User.findById(decoded.id).select("+refreshTokenHash");
            if (user && user.refreshTokenHash === hashRefreshToken(refreshToken)) {
                await User.findByIdAndUpdate(user._id, { refreshTokenHash: null });
            }
        } catch (error) {
            // An expired or invalid token cannot be used anyway; just clear it.
        }
    }

    res.status(200)
    .clearCookie("jwt_refresh" , options)
    .json(
        new ApiResponse(200 , {} , "User logged out successfully")
    )

    
});
// @desc    Get a new access token using the refresh-token cookie
// @route   POST /api/v1/users/refresh
// Rotation: every successful refresh issues a NEW refresh token and
// stores only its hash. The old refresh token stops working immediately,
// so a stolen old token cannot be replayed after a legitimate refresh.
// Reuse detection: if a valid refresh token does not match the stored
// hash, it may have been stolen and replayed, so all sessions are revoked.
export const refreshAccessToken = asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.jwt_refresh;
    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV !== "development",
        sameSite: "strict",
        maxAge: 30 * 24 * 60 * 60 * 1000,
    };

    if (!refreshToken) {
        throw new ApiError(401, "No refresh token provided.");
    }

    let decoded;
    try {
        decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    } catch (error) {
        res.clearCookie("jwt_refresh", options);
        throw new ApiError(401, "Refresh token is invalid or expired. Please log in again.");
    }

    const user = await User.findById(decoded.id).select("+refreshTokenHash");
    if (!user || !user.refreshTokenHash) {
        res.clearCookie("jwt_refresh", options);
        throw new ApiError(401, "Refresh token has been revoked. Please log in again.");
    }

    if (user.refreshTokenHash !== hashRefreshToken(refreshToken)) {
        // This token was already rotated or revoked: treat it as possible
        // theft and revoke the stored token too, forcing a fresh login.
        await User.findByIdAndUpdate(user._id, { refreshTokenHash: null });
        res.clearCookie("jwt_refresh", options);
        throw new ApiError(401, "Refresh token has been revoked. Please log in again.");
    }

    // A suspended account cannot refresh its way back in.
    await assertNotSuspended(user);

    const newAccessToken = generateAccessToken(user._id);
    const newRefreshToken = generateRefreshToken(user._id);
    await User.findByIdAndUpdate(user._id, { refreshTokenHash: hashRefreshToken(newRefreshToken) });

    const safeUser = await User.findById(user._id).select("-password -refreshTokenHash");

    res.status(200)
        .cookie("jwt_refresh", newRefreshToken, options)
        .json(
            new ApiResponse(200, { user: safeUser, accessToken: newAccessToken }, "Access token refreshed successfully")
        );
});
export const getUserImpactProfile = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    // 1. Fetch Emergencies Reported by User
    const emergencies = await EmergencyCase.find({ reporter: userId })
        .populate("assignedNgo", "organizationName")
        .select("animalInfo status createdAt");

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
            title: `Reported an injured ${emp.animalInfo?.species || "animal"}`,
            ngoName: emp.assignedNgo ? emp.assignedNgo.organizationName : "Pending NGO",
            status: emp.status,
            date: emp.createdAt
        });
    });

    supplies.forEach(sup => {
        // Find this user's pledge that was actually Received for this request
        const userPledge = sup.pledges.find(p => String(p.user) === String(userId) && p.status === "Received");
        if (userPledge) {
            timeline.push({
                type: "Supply",
                title: `Donated ${userPledge.pledgedQuantity} units for: ${sup.title}`,
                ngoName: sup.ngo ? sup.ngo.organizationName : "Unknown NGO",
                date: userPledge.pledgedAt
            });
        }
    });

    donations.forEach(camp => {
        // A user may have donated to the same campaign more than once:
        // show the total, dated at their most recent donation.
        const userDonations = camp.donors.filter(d => String(d.user) === String(userId));
        if (userDonations.length > 0) {
            const totalAmount = userDonations.reduce((sum, d) => sum + d.amount, 0);
            const latestDate = userDonations.reduce((latest, d) => (new Date(d.donatedAt) > new Date(latest) ? d.donatedAt : latest), userDonations[0].donatedAt);
            timeline.push({
                type: "Donation",
                title: `Funded ₹${totalAmount} towards: ${camp.title}`,
                ngoName: camp.ngo ? camp.ngo.organizationName : "Unknown NGO",
                date: latestDate
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