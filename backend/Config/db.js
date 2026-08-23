import mongoose from "mongoose";

const connectDB = async () => {
    try {
        // Connect to MongoDB using the URI from the .env file
        const conn = await mongoose.connect(process.env.MONGO_URI);
        
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(` MongoDB Connection Error: ${error.message}`);
        process.exit(1); // Stop the server if the database fails to connect
    }
};

export default connectDB;