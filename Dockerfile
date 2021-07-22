FROM node:10.13-alpine

WORKDIR /usr/src/app

COPY . . 

EXPOSE 8080
CMD [ "sh", "execute.sh" ]

