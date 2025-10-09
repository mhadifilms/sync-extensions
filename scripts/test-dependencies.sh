#!/bin/bash

# Test script to verify server dependencies are properly installed
# Run this after install.sh to confirm everything is working

echo "=== Testing Server Dependencies ==="
echo ""

# Check if we're in the right directory
if [ ! -f "server/package.json" ]; then
    echo "ERROR: server/package.json not found"
    echo "Please run this script from the sync-extensions root directory"
    exit 1
fi

echo "✅ Found server/package.json"

# Test AE extension dependencies
AE_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/com.sync.extension.ae.panel"
if [ -d "$AE_DIR/server" ]; then
    echo ""
    echo "Testing AE extension dependencies..."
    cd "$AE_DIR/server"
    
    if [ -d "node_modules" ]; then
        echo "✅ AE node_modules directory exists"
        
        # Check critical dependencies
        if [ -d "node_modules/express" ]; then
            echo "✅ AE express dependency found"
        else
            echo "❌ AE express dependency missing"
        fi
        
        if [ -d "node_modules/node-fetch" ]; then
            echo "✅ AE node-fetch dependency found"
        else
            echo "❌ AE node-fetch dependency missing"
        fi
        
        if [ -d "node_modules/cors" ]; then
            echo "✅ AE cors dependency found"
        else
            echo "❌ AE cors dependency missing"
        fi
        
        # Test server startup
        echo ""
        echo "Testing AE server startup..."
        if timeout 5s node src/server.js > /dev/null 2>&1; then
            echo "✅ AE server starts successfully"
        else
            echo "❌ AE server failed to start"
        fi
    else
        echo "❌ AE node_modules directory missing"
    fi
    
    cd - > /dev/null
else
    echo "⚠️  AE extension not found at $AE_DIR"
fi

# Test Premiere extension dependencies
PPRO_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/com.sync.extension.ppro.panel"
if [ -d "$PPRO_DIR/server" ]; then
    echo ""
    echo "Testing Premiere extension dependencies..."
    cd "$PPRO_DIR/server"
    
    if [ -d "node_modules" ]; then
        echo "✅ Premiere node_modules directory exists"
        
        # Check critical dependencies
        if [ -d "node_modules/express" ]; then
            echo "✅ Premiere express dependency found"
        else
            echo "❌ Premiere express dependency missing"
        fi
        
        if [ -d "node_modules/node-fetch" ]; then
            echo "✅ Premiere node-fetch dependency found"
        else
            echo "❌ Premiere node-fetch dependency missing"
        fi
        
        if [ -d "node_modules/cors" ]; then
            echo "✅ Premiere cors dependency found"
        else
            echo "❌ Premiere cors dependency missing"
        fi
        
        # Test server startup
        echo ""
        echo "Testing Premiere server startup..."
        if timeout 5s node src/server.js > /dev/null 2>&1; then
            echo "✅ Premiere server starts successfully"
        else
            echo "❌ Premiere server failed to start"
        fi
    else
        echo "❌ Premiere node_modules directory missing"
    fi
    
    cd - > /dev/null
else
    echo "⚠️  Premiere extension not found at $PPRO_DIR"
fi

echo ""
echo "=== Dependency Test Complete ==="
echo ""
echo "If any dependencies are missing, run:"
echo "  ./scripts/install.sh --ae    # For After Effects"
echo "  ./scripts/install.sh --premiere  # For Premiere Pro"
echo "  ./scripts/install.sh --both  # For both"
