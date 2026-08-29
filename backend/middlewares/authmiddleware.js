import jwt from "jsonwebtoken"
import { User } from "../Models/usermodel.js"
import { ApiError } from "../utils/ApiError.js"
import { asyncHandler } from "../utils/asyncHandler.js"

export const verifyJWT = asyncHandler (async (req,res,next)=>{

   try {
     const token = req.header("Authorization")?.replace("Bearer ","");
 
     if(!token){
         throw new ApiError(401, "Unauthorized request: No token provided")
     }
 
     const decodedToken = jwt.verify(token , process.env.ACCESS_TOKEN_SECRET);
 
     const user = await User.findById(decodedToken.id).select("-password")
     if(!user){
     throw new ApiError(401, "Invalid Access Token")
     }
 
     req.user= user;
     next();
   } catch (error) {
       throw new ApiError(401, error?.message || "Invalid Access Token")
   }

   
});
// Middleware to check if the logged-in user has the NGO role
export const isNgo = asyncHandler(async (req, res, next) => {
    // req.user is already provided by verifyJWT, which runs right before this
    if (req.user && req.user.role === "ngo") {
        next(); // They are an NGO, let them proceed
    } else {
        throw new ApiError(403, "Access denied: You must be registered as an NGO to perform this action");
    }
});