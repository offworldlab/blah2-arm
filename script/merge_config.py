#!/usr/bin/env python3
"""
Config merge script for blah2

Designed to be run in both blah2 and blah2-api containers with baked-in configs.
Merges default.yml + user.yml + forced.yml into config.yml. 
Also populates the node-id field in user.yml by reading the RPi serial number.

Takes as inputs:
1. Defaults directory - holds baked-in default.yml and forced.yml
2. User config path - the path to the shared persistent directory (in the /data partition) 
   where the user config overlay, user.yml. If this does not exist, it is created by copying defaults.yml.
3. Output config path - the output location of the generated merged config file, 
   should live separately in each container to avoid race conditions
4. (Optional) debug output config path - a debug copy showing the full currently configured state 
   as defined by user.yml, default.yml and forced.yml

Merge order (later overrides earlier):
  default.yml -> user.yml -> forced.yml
"""

import yaml
import os
import sys
import shutil
from mergedeep import merge


def get_rpi_serial():
    """Extract last 8 characters of RPi serial number (Pi hardware only)"""
    try:
        with open('/proc/cpuinfo', 'r') as f:
            content = f.read()
            
            # Check if this is a Raspberry Pi
            if 'Raspberry Pi' not in content and 'BCM' not in content:
                return None
            
            # Extract serial
            for line in content.splitlines():
                if line.startswith('Serial'):
                    serial = line.split(':')[1].strip()
                    # Just take last 8 hex characters
                    if len(serial) >= 8 and serial != '0000000000000000':
                        return serial[-8:]
    except Exception as e:
        print(f"Could not read RPi serial: {e}")
    
    return None


def ensure_node_id(user_config_path):
    """Add/update node_id in user config to match hardware serial"""
    try:
        # Load current user config
        with open(user_config_path, 'r') as f:
            user_config = yaml.safe_load(f) or {}
        
        # Generate node_id from hardware serial
        serial = get_rpi_serial()
        if not serial:
            print("Not running on RPi hardware, skipping node_id generation")
            return
        
        node_id = f"ret{serial}"
        
        # Check if node_id already exists
        if 'network' in user_config and 'node_id' in user_config['network']:
            current_id = user_config['network']['node_id']
            if current_id == node_id:
                print(f"Node ID already correct: {node_id}")
                return
            else:
                # Node ID changed (board swap) - update it
                print(f"Node ID mismatch - updating from '{current_id}' to '{node_id}'")
        else:
            print(f"Generating node_id from hardware serial: {node_id}")
        
        # Add/update node_id to network section
        if 'network' not in user_config:
            user_config['network'] = {}
        user_config['network']['node_id'] = node_id
        
        # Write back to user config (atomic)
        temp_path = user_config_path + '.node_id_tmp.' + str(os.getpid())
        with open(temp_path, 'w') as f:
            yaml.dump(user_config, f, default_flow_style=False, sort_keys=False)
        os.rename(temp_path, user_config_path)
        
        print(f"Node ID set in {user_config_path}")
        
    except Exception as e:
        print(f"Warning: Failed to ensure node_id: {e}")
        # Don't exit - continue with merge even if node_id fails


def main():
    # Parse command-line arguments
    if len(sys.argv) != 5:
        print("Usage: merge_config.py <defaults_dir> <user_config_path> <output_config_path> <debug_copy_path>")
        print("Example: merge_config.py /opt/blah2/defaults /opt/blah2/config/user.yml /opt/blah2/config.yml /opt/blah2/config/config.blah2.yml")
        sys.exit(1)
    
    defaults_dir = sys.argv[1]
    user_config_path = sys.argv[2]
    output_config_path = sys.argv[3]
    debug_copy_path = sys.argv[4]
    
    # Construct paths
    default_config = os.path.join(defaults_dir, 'default.yml')
    forced_config = os.path.join(defaults_dir, 'forced.yml')
    
    try:
        # Load default config (baked into container)
        print(f"Loading default config from {default_config}")
        with open(default_config, 'r') as f:
            config = yaml.safe_load(f)
        
        if not config:
            print("ERROR: Default config is empty or invalid")
            sys.exit(1)
        
        # Create user config from defaults if it doesn't exist (atomic)
        if not os.path.exists(user_config_path):
            print(f"User config not found, copying from defaults...")
            os.makedirs(os.path.dirname(user_config_path), exist_ok=True)
            
            # Write to temp file first, then atomic rename
            temp_path = user_config_path + '.tmp.' + str(os.getpid())
            shutil.copy(default_config, temp_path)
            try:
                os.rename(temp_path, user_config_path)  # Atomic on POSIX
                print(f"Created {user_config_path}")
            except (FileExistsError, OSError):
                # Another process created it first, clean up temp
                if os.path.exists(temp_path):
                    os.remove(temp_path)
                print(f"User config was created by another process")
        
        # Ensure node_id exists and matches hardware (add/update if needed, Pi only)
        ensure_node_id(user_config_path)
        
        # Overlay user config if it exists and has content
        if os.path.exists(user_config_path):
            print(f"Loading user config from {user_config_path}")
            with open(user_config_path, 'r') as f:
                user = yaml.safe_load(f)
            
            if user:  # Only merge if user.yml has actual content
                print("Applying user overrides...")
                merge(config, user)
            else:
                print("User config is empty, using defaults")
        
        # Overlay forced config (highest priority)
        if os.path.exists(forced_config):
            print(f"Loading forced config from {forced_config}")
            with open(forced_config, 'r') as f:
                forced = yaml.safe_load(f)
            
            if forced:  # Only merge if content exists
                print("Applying forced overrides...")
                merge(config, forced)
        
        # Write merged config to output
        print(f"Writing merged config to {output_config_path}")
        os.makedirs(os.path.dirname(output_config_path), exist_ok=True)
        with open(output_config_path, 'w') as f:
            yaml.dump(config, f, default_flow_style=False, sort_keys=False)
        
        # Write debug copy to shared location
        if debug_copy_path:
            print(f"Writing debug copy to {debug_copy_path}")
            os.makedirs(os.path.dirname(debug_copy_path), exist_ok=True)
            shutil.copy(output_config_path, debug_copy_path)
        
        print("Config merge completed successfully!")
        
    except Exception as e:
        print(f"ERROR during config merge: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()