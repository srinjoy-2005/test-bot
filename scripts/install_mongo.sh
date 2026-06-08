#!/bin/bash
# MongoDB 7.0 Installation Script for Ubuntu 22.04 (WSL2)
set -e

echo "📦 Installing MongoDB 7.0..."

# Step 1: Import MongoDB public GPG key
echo "  → Importing GPG key..."
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
    sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg

# Step 2: Add MongoDB apt repository
echo "  → Adding apt repository..."
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
    sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list > /dev/null

# Step 3: Update package index and install
echo "  → Running apt-get update (MongoDB repo only)..."
sudo apt-get update -qq -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/mongodb-org-7.0.list -o Dir::Etc::sourceparts="-" -o APT::Get::List-Cleanup="0"

echo "  → Installing mongodb-org..."
sudo apt-get install -y mongodb-org

# Step 4: Create data and log directories if needed
sudo mkdir -p /var/lib/mongodb
sudo mkdir -p /var/log/mongodb
sudo chown -R mongodb:mongodb /var/lib/mongodb
sudo chown -R mongodb:mongodb /var/log/mongodb

# Step 5: Start MongoDB
echo "  → Starting mongod..."
if systemctl is-system-running &>/dev/null; then
    sudo systemctl start mongod
    sudo systemctl enable mongod
    echo "  → mongod started via systemd"
else
    # WSL2 fallback if systemd not fully functional
    sudo mongod --dbpath /var/lib/mongodb --logpath /var/log/mongodb/mongod.log --fork
    echo "  → mongod started in background (forked)"
fi

# Step 6: Verify
echo ""
echo "  → Verifying connection..."
sleep 2
mongosh --eval 'db.adminCommand("ping")' --quiet && echo "✅ MongoDB is running!" || echo "❌ MongoDB failed to start"

echo ""
echo "Done! MongoDB is ready at mongodb://localhost:27017"
