import * as b from 'bonjour';
import { app, dialog, ipcMain } from 'electron';
import * as mdns from 'mdns';
import * as network from 'network';
import * as os from 'os';
import * as WebSocket from 'ws';

import { requestModel, requestModelHelo } from '../../src/app/models/request.model';
import { responseModelHelo, responseModelPong, responseModelRequestSync } from '../../src/app/models/response.model';
import { Config } from '../config';
import { Handler } from '../models/handler.model';
import { UiHandler } from './ui.handler';

const bonjour = b();

export class ConnectionHandler implements Handler {
    private fallBackBonjour: b.Service;
    private uiHandler: UiHandler;
    private mdnsAd: mdns.Advertisement;
    private wsClients: WebSocket[] = [];

    private static instance: ConnectionHandler;
    private constructor(uiHandler: UiHandler) {
        this.uiHandler = uiHandler;
        ipcMain
            .on('lastScanDateMismatch', (event, deviceId) => {
                if (this.wsClients[deviceId] && this.wsClients[deviceId].OPEN == WebSocket.OPEN) {
                    //console.log('lastScanDateMismatch for device ' + deviceId + ' requesting sync')
                    this.wsClients[deviceId].send(JSON.stringify(new responseModelRequestSync()));
                }
            })
            .on('getLocalAddresses', (event, arg) => {
                network.get_interfaces_list((err, networkInterfaces) => {
                    let addresses = [];

                    for (let key in networkInterfaces) {
                        let ip = networkInterfaces[key].ip_address;
                        if (ip) {
                            addresses.push(ip);
                        }
                    };
                    event.sender.send('localAddresses', addresses);
                });
            }).on('getDefaultLocalAddress', (event, arg) => {
                network.get_private_ip((err, ip) => {
                    event.sender.send('defaultLocalAddress', ip);
                });
            }).on('getHostname', (event, arg) => {
                event.sender.send('hostname', os.hostname());
            })


    }

    static getInstance(uiHandler: UiHandler) {
        if (!ConnectionHandler.instance) {
            ConnectionHandler.instance = new ConnectionHandler(uiHandler);
        }
        return ConnectionHandler.instance;
    }

    announceServer() {
        try {
            this.mdnsAd = mdns.createAdvertisement(mdns.tcp('http'), Config.PORT, {
                name: Config.APP_NAME + ' - ' + this.getServerUniqueNumber()
            });
            this.mdnsAd.start();
        } catch (ex) {
            dialog.showMessageBox(this.uiHandler.mainWindow, {
                type: 'warning',
                title: 'Error',
                message: 'Apple Bonjour is missing.\nThe app may fail to detect automatically the server.\n\nTo remove this alert try to install ' + Config.APP_NAME + ' again with an administrator account and reboot your system.',
            });
            this.fallBackBonjour = bonjour.publish({ name: Config.APP_NAME + ' - ' + this.getServerUniqueNumber(), type: 'http', port: Config.PORT })
            this.fallBackBonjour.on('error', err => { // err is never set?
                dialog.showMessageBox(this.uiHandler.mainWindow, {
                    type: 'error',
                    title: 'Error',
                    message: 'An error occured while announcing the server.'
                });
            });
        }
    }

    removeServerAnnounce() {
        if (this.fallBackBonjour) {
            bonjour.unpublishAll(() => { })
        }

        if (this.mdnsAd) {
            this.mdnsAd.stop();
        }
    }

    onWsMessage(ws: WebSocket, message: any) {
        switch (message.action) {
            case requestModel.ACTION_PING: {
                ws.send(JSON.stringify(new responseModelPong()));
                break;
            }

            case requestModel.ACTION_HELO: {
                let request: requestModelHelo = message;
                let response = new responseModelHelo();
                response.fromObject({
                    version: app.getVersion()
                });

                if (request && request.deviceId) {
                    this.wsClients[request.deviceId] = ws;
                }
                ws.send(JSON.stringify(response));
                break;
            }
        }
    }

    onWsClose(ws: WebSocket) {
        // this.removeClient();
    }

    onWsError(ws: WebSocket, err: Error) {
        // this.removeClient();
    }

    // TODO: invece di accedere a wsClients con l'indice cercare ws
    // private removeClient(ws: WebSocket) {
    //     if (this.deviceId && this.wsClients[this.deviceId]) {
    //         delete this.wsClients[this.deviceId];
    //     }
    // }

    private getServerUniqueNumber() {
        let hostname = os.hostname();
        let result = '';
        for (let i = 0; i < hostname.length; i++) {
            result += hostname[i].charCodeAt(0);
        }
        return result.substring(0, 10);
    }

}

