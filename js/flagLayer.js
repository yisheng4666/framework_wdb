//---------------------------------------------------------------------------
//  File: FlagLayer.js
//  Change: 杨国强，创建于2016-09-21
//
//---------------------------------------------------------------------------

function FlagLayer(layer) {
	if (!layer.data) {
		layer.data = [];
		for (let i=0;i<100;i++) {
			layer.data.push([Math.random()*1.5+115.4,Math.random()*1.5+39.4,'医院'+(i+1)]);
		}
	}
	var layerData = layer.data;
	
	var previewCanvas, previewImage, mainCanvas;
	var drawMain = null; // 绘制主画布
	var drawPreview = null; // 绘制预览画布
	var vertexShaderStr = `
			precision mediump float;
			const float PI = 3.1415926536;
			const float RADIAN_HALF = 3.1415926536/360.0;
			const float RADIAN_REVERSE = 180.0/3.1415926536;
			
			vec2 mercatorProjectViewport(
			  vec3 lnglat,
			  vec3 mapParam, // center lat, center lon, zoom
			  vec2 viewport // viewport: [width, height]
			) {
				float y2 = log(tan(PI / 4.0 + lnglat.y * RADIAN_HALF));
        return vec2( (lnglat.x - mapParam.x) * mapParam.z / viewport[0],
            (y2 - mapParam.y) * RADIAN_REVERSE * mapParam.z / viewport[1] );
			}

			attribute vec3 scatterData;  // lat, lon, pointPos
			uniform vec3 mapParam;  // center lat, center lon, zoom
			uniform vec2 viewPort;
			uniform vec4 latlonRange;
			uniform float uSize;

			varying vec2 vTexCoord;
			void main(void)
			{
				vec2 pos;
				float radiusX = uSize;
		    float radiusY = radiusX * viewPort[0]/viewPort[1];
		    if (latlonRange[0]<=0.0) {
		    	pos = mercatorProjectViewport(scatterData, mapParam, viewPort);
		    } else {
		    	pos = vec2((scatterData[0]-latlonRange[0])/latlonRange[1],(scatterData[1]-latlonRange[2])/latlonRange[3]);
		    	radiusY = radiusX;
		    }
				if (scatterData[2]==0.0) {
					gl_Position = vec4(pos[0]-radiusX, pos[1]-radiusY, 0.0, 1.0);
					vTexCoord = vec2(1.0, 1.0);
				} else if (scatterData[2]==1.0) {
					gl_Position = vec4(pos[0]+radiusX, pos[1]-radiusY, 0.0, 1.0);
					vTexCoord = vec2(0.0, 1.0);
				} else if (scatterData[2]==2.0) {
					gl_Position = vec4(pos[0]-radiusX, pos[1]+radiusY, 0.0, 1.0);
					vTexCoord = vec2(1.0, 0.0);
				} else {
					gl_Position = vec4(pos[0]+radiusX, pos[1]+radiusY, 0.0, 1.0);
					vTexCoord = vec2(0.0, 0.0);
				}
			}
	`;

	var fragmentShaderStr = `
      precision lowp float;
			uniform sampler2D sampler;
			uniform float layerOpacity;
			varying vec2 vTexCoord;

			void main(void)
			{
				gl_FragColor = texture2D(sampler, vTexCoord);
				gl_FragColor.w = gl_FragColor.w * layerOpacity;
			}
	`;

	
	var lonRange = GlobalVar.LonRange;
	var latRange = GlobalVar.LatRange;
	var buf = [];
	function initCanvas() {		
		let index = 0;
		let min = Number.MAX_VALUE, max = Number.MIN_VALUE;
		for (let i=0,n=layerData.length;i<n;i++) {
			let d = layerData[i];
			if (d[0]<lonRange[0]) lonRange[0] = d[0];
			if (d[0]>lonRange[1]) lonRange[1] = d[0];
			if (d[1]<latRange[0]) latRange[0] = d[1];
			if (d[1]>latRange[1]) latRange[1] = d[1];
			for (let j=0;j<6;j++) {
				buf[index++] = d[0];
				buf[index++] = d[1];
				buf[index++] = j<3 ? j : (j-2);
			}
		}
		
		previewCanvas = document.getElementById('layerPreviewCanvas');
		previewImage = document.getElementById('layerPreviewImage'+layer.id);
		mainCanvas = document.getElementById('layerMainCanvas');
		if (viewerIndex==0) // 只有第一个二维视图负责绘制缩略图
			drawPreview = initWebGL(previewCanvas, 1);
		drawMain = initWebGL(mainCanvas, 0);

		if (drawPreview) {
			drawPreview();
	  	setLayerPreviewImg(layer.id, previewCanvas.toDataURL("image/png")); 
		}
	}

	var img = new Image();
	img.onload = function(){
		initCanvas();
	};	
	img.src = layer.flagImage ? layer.flagImage : './img/spot.png';
	
	function initWebGL(canvasObject, isPreview) {
		let webgl = canvasObject.getContext('webgl');
		
    let vertexShaderObject = webgl.createShader(webgl.VERTEX_SHADER);
    let fragmentShaderObject = webgl.createShader(webgl.FRAGMENT_SHADER);

    webgl.shaderSource(vertexShaderObject, vertexShaderStr);
    webgl.shaderSource(fragmentShaderObject, fragmentShaderStr);

    webgl.compileShader(vertexShaderObject);
    webgl.compileShader(fragmentShaderObject);

    if(!webgl.getShaderParameter(vertexShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(vertexShaderObject));return;}
    if(!webgl.getShaderParameter(fragmentShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(fragmentShaderObject));return;}

    let programObject = webgl.createProgram();

    webgl.attachShader(programObject, vertexShaderObject);
    webgl.attachShader(programObject, fragmentShaderObject);

    webgl.linkProgram(programObject);
    if(!webgl.getProgramParameter(programObject, webgl.LINK_STATUS)){console.error(webgl.getProgramInfoLog(programObject));return;}

    webgl.useProgram(programObject);

    let attrScatterData = webgl.getAttribLocation(programObject, "scatterData");
    let attrMapParam = webgl.getUniformLocation(programObject, "mapParam");
    let attrViewPort = webgl.getUniformLocation(programObject, "viewPort");
    let attrSize = webgl.getUniformLocation(programObject, "uSize");
    let attrLatlonRange = webgl.getUniformLocation(programObject, "latlonRange");
    let attrOpacity = webgl.getUniformLocation(programObject, "layerOpacity");
	  webgl.uniform1f(attrOpacity, 1);
   
    let scatterBuffer = webgl.createBuffer();
	  if (isPreview) {
		  webgl.uniform4f(attrLatlonRange, lonRange[0]+(lonRange[1]-lonRange[0])/2, (lonRange[1]-lonRange[0])/2, latRange[0]+(latRange[1]-latRange[0])/2, (latRange[1]-latRange[0])/2);
		  webgl.uniform1f(attrSize, 0.05);
		} else {
		  webgl.uniform4f(attrLatlonRange, -1, 0,0,0);
		  webgl.uniform1f(attrSize, 0.015);
		}
				  
		webgl.bindBuffer(webgl.ARRAY_BUFFER, scatterBuffer);
	  webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(buf), webgl.DYNAMIC_DRAW);
    
		var textid = webgl.createTexture();
    webgl.activeTexture(webgl.TEXTURE0);
		webgl.bindTexture(webgl.TEXTURE_2D,textid);
		webgl.texParameteri(webgl.TEXTURE_2D,webgl.TEXTURE_MIN_FILTER,webgl.LINEAR);
		webgl.texParameteri(webgl.TEXTURE_2D,webgl.TEXTURE_MAG_FILTER,webgl.LINEAR);
		webgl.texImage2D(webgl.TEXTURE_2D,0,webgl.RGBA,webgl.RGBA,webgl.UNSIGNED_BYTE,img);
		var sampler = webgl.getUniformLocation(programObject, "sampler");
		webgl.uniform1i(sampler,0);
		
    return function() {
    	webgl.useProgram(programObject);
		  
		  if (!isPreview) {
			  let temp = ol.proj.toLonLat(map.getView().getCenter());
			  let center = {lon:temp[0], lat:temp[1]};//map.center();
			  temp = map.getSize();
			  let size = {x:temp[0],y:temp[1]};//map.size();
			  let mapedlat = Math.log(Math.tan(Math.PI / 4.0 + center.lat * Math.PI / 360.0));
			  let k = Math.pow(2.0, map.getView().getZoom() - 3.0) * 512.0 / 45.0;
			  webgl.uniform3fv(attrMapParam, [center.lon, mapedlat, k]);
			  webgl.uniform2fv(attrViewPort, [size.x,size.y]);
			  webgl.uniform1f(attrOpacity, layer.opacity);
			  let viewRatio = size.x/1300;
		  	if (map.getView().getZoom()>10)
		  		webgl.uniform1f(attrSize, 0.012/viewRatio);
		  	else if (map.getView().getZoom()>8)
		  		webgl.uniform1f(attrSize, 0.01/viewRatio);
		  	else
		  		webgl.uniform1f(attrSize, 0.005/viewRatio);
		  } else {
		  	webgl.clearColor(0.0, 0.0, 0.0, 0.8);
		  	webgl.clear(webgl.COLOR_BUFFER_BIT);
		  }
		  
			webgl.activeTexture(webgl.TEXTURE0);
			webgl.bindTexture(webgl.TEXTURE_2D, textid);
			
		  webgl.bindBuffer(webgl.ARRAY_BUFFER, scatterBuffer);
		  webgl.enableVertexAttribArray(attrScatterData); 
		  webgl.vertexAttribPointer(attrScatterData, 3, webgl.FLOAT, false, 0, 0);
		  webgl.drawArrays(webgl.TRIANGLES, 0, buf.length/3);

		}
	}
		
	layer.onDraw = function() {
		if (drawMain) {
			drawMain();
		}
	}
	
	layer.onMouseMove = function(pos) {
		for (let i=0,n=layerData.length;i<n;i++) {
			// let mapPos = map.locationPointArray(layerData[i]);
			let mapPos = {x:layerData[i][0],y:layerData[i][1]};
			if (Math.abs(mapPos.x-pos.x)<9 && Math.abs(mapPos.y-pos.y)<9) {
				setLayerPreviewInfo(layer.id, ''+layerData[i][2], ''+(layerData[i][3]?layerData[i][3]:''));
				break;
			}
		}
	}
}
