import mongoose, { Schema } from "mongoose";
export const User = mongoose.model(
  "User",
  new Schema(
    {
      googleId: { type: String, required: true, unique: true },
      email: { type: String, required: true },
      name: { type: String, required: true },
      role: { type: String, enum: ["admin", "member"], default: "member" },
    },
    { timestamps: true },
  ),
);
export const Note = mongoose.model(
  "Note",
  new Schema(
    {
      title: { type: String, required: true, maxlength: 200 },
      body: { type: String, required: true, maxlength: 10000 },
      ownerId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true,
      },
    },
    { timestamps: true },
  ),
);
Note.schema.index({ ownerId: 1, createdAt: -1, _id: -1 });
