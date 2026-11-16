FROM node:22-alpine
WORKDIR /srv
COPY package.json ./
RUN npm install --omit=dev
COPY index.js ident.js invite.html ./
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 7700/udp 7701/udp 7780/tcp
CMD ["node", "index.js"]
