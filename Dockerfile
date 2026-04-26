FROM nginx:alpine
COPY . /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/conf.d/default.conf.bak
ENV PORT=8080
CMD ["/bin/sh", "-c", "sed -i \"s/__PORT__/$PORT/g\" /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
