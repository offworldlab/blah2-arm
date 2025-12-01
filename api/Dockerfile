FROM node:20

LABEL maintainer="30hours <nathan@30hours.dev>"
LABEL org.opencontainers.image.source https://github.com/30hours/blah2

# Create app directory
WORKDIR /usr/src/app

# Install Python and dependencies for config merging
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && pip3 install --break-system-packages pyyaml mergedeep \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY api/package*.json ./

RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY api/ .

# Copy config files into container (baked in, not mounted)
RUN mkdir -p /usr/src/app/defaults
COPY config/default.yml /usr/src/app/defaults/default.yml
COPY config/forced.yml /usr/src/app/defaults/forced.yml

# Copy merge script 
RUN mkdir -p /usr/src/app/script
COPY script/merge_config.py /usr/src/app/script/merge_config.py
RUN chmod +x /usr/src/app/script/merge_config.py

EXPOSE 8080
CMD [ "node", "server.js" ]
