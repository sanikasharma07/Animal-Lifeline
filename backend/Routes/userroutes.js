import {Router} from "express";
import { registerUser , loginuser, logoutUser, refreshAccessToken, getUserImpactProfile} from "../Controllers/usercontroller.js";
import { verifyJWT } from "../middlewares/authmiddleware.js";


const userRouter = Router();
userRouter.route("/register").post(registerUser);
userRouter.route("/login").post(loginuser);
// Logout no longer requires a valid access token: a user whose access
// token has expired must still be able to revoke their refresh token.
userRouter.route("/logout").post(logoutUser);
userRouter.route("/refresh").post(refreshAccessToken);
userRouter.route("/impact-profile").get(verifyJWT, getUserImpactProfile);

export default userRouter;
