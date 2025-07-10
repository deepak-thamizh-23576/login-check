const mongoose = require("mongoose");

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

module.exports = mongoose.model("Task", taskSchema);
