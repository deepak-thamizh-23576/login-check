const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema({
  name: String,
  date: String,
  imageUrl: String,
  userId: String,
});

module.exports = mongoose.model("Task", taskSchema);
