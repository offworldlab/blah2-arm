FROM httpd:2.4
LABEL maintainer="OffWorld Lab"
LABEL org.opencontainers.image.source https://github.com/offworldlabs/blah2-arm

ARG VERSION=dev

COPY html/ /usr/local/apache2/htdocs/
RUN sed -i "s/__BLAH2_VERSION__/${VERSION}/g" /usr/local/apache2/htdocs/index.html