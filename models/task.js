const mongoose = require("mongoose");


const userSchema = new mongoose.Schema({
  firebaseUid: String,
  email: String,
  signInProvider: String,
  zohoRefreshToken: String,
  zohoUserId: String,
});

const taskSchema = new mongoose.Schema({
  name: String,
  date: String,
  imageUrl: String,
  userId: String,
  status: {
    type: String,
    enum: ["pending", "completed"],
    default: "pending"
  }
});

const collection = mongoose.model("collection", userSchema);
const Task = mongoose.model("Task", taskSchema);

module.exports = { collection, Task };
