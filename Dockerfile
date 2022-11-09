FROM node:18
EXPOSE 3000
WORKDIR /app
COPY . .
RUN yarn
CMD [ "start" ]
