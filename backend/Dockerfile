FROM node:18-slim

# Set working directory
WORKDIR /app

# Copy all files (including local node_modules containing prebuilt Linux x64 binaries)
COPY . .

# Expose port
EXPOSE 3002

# Startup command with increased V8 heap memory limit to prevent OOM
CMD ["node", "--max-old-space-size=6144", "src/server.js"]