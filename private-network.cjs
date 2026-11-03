const {BlockList}=require('node:net');
const allowed=new BlockList();
for(const [ip,bits] of [['127.0.0.0',8],['10.0.0.0',8],['172.16.0.0',12],['192.168.0.0',16],['100.64.0.0',10],['169.254.0.0',16]]) allowed.addSubnet(ip,bits,'ipv4');
for(const [ip,bits] of [['::1',128],['fc00::',7],['fe80::',10]]) allowed.addSubnet(ip,bits,'ipv6');
function isPrivateAddress(address='') {
 address=address.toLowerCase().split('%')[0];
 if(address.startsWith('::ffff:')) address=address.slice(7);
 try{return allowed.check(address,address.includes(':')?'ipv6':'ipv4')}catch{return false}
}
function privateNetwork(req,res,next){
 if(!isPrivateAddress(req.socket.remoteAddress)) return res.status(403).send('Private network access only');
 next();
}
module.exports={isPrivateAddress,privateNetwork};
