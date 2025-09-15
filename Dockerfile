# Use Node.js 18 Alpine as base image
FROM node:18-alpine

# Install pnpm
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN pnpm install --prod

# Copy TypeScript config and source code
COPY tsconfig.json ./
COPY src/ ./src/

# Install dev dependencies for building
RUN pnpm add -D typescript ts-node

# Build the TypeScript code
RUN pnpm run build

# Remove dev dependencies to reduce image size
RUN pnpm prune --prod

# Install curl for healthcheck (before switching to non-root user)
RUN apk add --no-cache curl

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S botuser -u 1001

# Change ownership of the app directory
RUN chown -R botuser:nodejs /app
USER botuser

# Expose port (not really needed for this bot, but good practice)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD pgrep -f "node dist/index.js" > /dev/null || exit 1

# Start the bot
CMD ["pnpm", "start"]
