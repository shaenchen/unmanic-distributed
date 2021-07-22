docker build -t personal/unmanic-distributed .
docker run -d -p 49163:8080 -v '/mnt/cache/appdata/unmanic-distributed/src/':'/src':'rw' --name='personal-unmanic-distributed' personal/unmanic-distributed

